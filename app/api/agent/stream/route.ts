export const runtime = 'edge';
export const preferredRegion = ['sin1', 'hkg1', 'bom1'];

import { NextRequest } from 'next/server';

import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
  DEFAULT_TEMPERATURE,
  OPENAI_CHAT_URL,
  buildMessages,
  createOpenAIHeaders,
  getUserMessage,
  readErrorDetail,
  type ChatRequestBody,
  validateEnv,
} from '../shared';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
} as const;

function formatSSE(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;

  try {
    body = await req.json();
  } catch {
    return new Response(formatSSE('error', { detail: 'Invalid JSON body' }), {
      headers: SSE_HEADERS,
      status: 400,
    });
  }

  const userMessage = getUserMessage(body, 'Hello');

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
    const organization = process.env.OPENAI_ORGANIZATION?.trim();
    const project = (process.env.OPENAI_PROJECT_ID ?? process.env.OPENAI_PROJECT)?.trim();

    validateEnv('OPENAI_API_KEY', apiKey);

    let upstream: Response;

    try {
      upstream = await fetch(OPENAI_CHAT_URL, {
        method: 'POST',
        headers: createOpenAIHeaders(apiKey, { organization, project }),
        body: JSON.stringify({
          model,
          messages: buildMessages(userMessage),
          temperature: DEFAULT_TEMPERATURE,
          max_tokens: DEFAULT_MAX_TOKENS,
          stream: true,
        }),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return new Response(formatSSE('error', { detail }), {
        headers: SSE_HEADERS,
        status: 504,
      });
    }

    const fallbackStatus = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 500;

    if (!upstream.ok || !upstream.body) {
      const detail = await readErrorDetail(upstream);

      return new Response(formatSSE('error', {
        detail,
        status: upstream.status,
        statusText: upstream.statusText,
      }), {
        headers: SSE_HEADERS,
        status: fallbackStatus,
      });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = upstream.body.getReader();

    const stream = new ReadableStream({
      async start(controller) {
        let released = false;
        const releaseReader = () => {
          if (!released) {
            try {
              reader.releaseLock();
            } catch {
              // Ignore release errors; the reader may already be released.
            }
            released = true;
          }
        };

        try {
          let buffer = '';

          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const raw of lines) {
              const line = raw.trim();
              if (!line.startsWith('data:')) {
                continue;
              }

              const data = line.slice(5).trim();
              if (data === '[DONE]') {
                controller.enqueue(encoder.encode(formatSSE('done', {})));
                releaseReader();
                controller.close();
                return;
              }

              try {
                const obj = JSON.parse(data);
                const delta = obj?.choices?.[0]?.delta?.content;
                if (delta) {
                  controller.enqueue(encoder.encode(formatSSE('message', { text: delta })));
                }
              } catch (error) {
                controller.enqueue(encoder.encode(formatSSE('error', {
                  detail: error instanceof Error ? error.message : String(error),
                })));
                releaseReader();
                controller.close();
                return;
              }
            }
          }

          releaseReader();
          controller.close();
        } catch (error) {
          controller.enqueue(encoder.encode(formatSSE('error', {
            detail: error instanceof Error ? error.message : String(error),
          })));
          releaseReader();
          controller.close();
        } finally {
          releaseReader();
        }
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return new Response(formatSSE('error', { detail }), {
      headers: SSE_HEADERS,
      status: detail.startsWith('Missing required environment variable') ? 500 : 504,
    });
  }
}
