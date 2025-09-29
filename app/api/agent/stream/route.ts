export const runtime = 'edge';
export const preferredRegion = ['sin1', 'hkg1', 'bom1'];

import { NextRequest } from 'next/server';

type ChatRequestBody = {
  message?: unknown;
};

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
} as const;

function validateEnv(variable: string, value: string | undefined): asserts value is string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${variable}`);
  }
}

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

  const userMessage = typeof body?.message === 'string' && body.message.trim().length > 0
    ? body.message
    : 'Hello';

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

    validateEnv('OPENAI_API_KEY', apiKey);

    const url = 'https://api.openai.com/v1/chat/completions';

    let upstream: Response;

    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant for a Singapore Government analysis portal.',
            },
            {
              role: 'user',
              content: userMessage,
            },
          ],
          temperature: 0.2,
          max_tokens: 600,
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
      const contentType = upstream.headers.get('content-type') ?? '';
      let detail: unknown;

      if (contentType.includes('application/json')) {
        try {
          detail = await upstream.json();
        } catch {
          detail = await upstream.text();
        }
      } else {
        detail = await upstream.text();
      }

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
                controller.close();
                return;
              }

              try {
                const obj = JSON.parse(data);
                const delta = obj?.choices?.[0]?.delta?.content;
                if (delta) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`));
                }
              } catch (error) {
                controller.enqueue(encoder.encode(formatSSE('error', {
                  detail: error instanceof Error ? error.message : String(error),
                })));
                controller.close();
                return;
              }
            }
          }

          controller.close();
        } catch (error) {
          controller.enqueue(encoder.encode(formatSSE('error', {
            detail: error instanceof Error ? error.message : String(error),
          })));
          controller.close();
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
