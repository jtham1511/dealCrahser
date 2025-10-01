export const runtime = 'edge';
export const preferredRegion = ['sin1', 'hkg1', 'bom1'];

import { NextRequest, NextResponse } from 'next/server';

import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
  DEFAULT_TEMPERATURE,
  OPENAI_CHAT_URL,
  buildMessages,
  getUserMessage,
  type ChatRequestBody,
  validateEnv,
} from './shared';

type OpenAIChatCompletion = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const userMessage = getUserMessage(body, 'Hello');

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;

    validateEnv('OPENAI_API_KEY', apiKey);

    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: buildMessages(userMessage),
        temperature: DEFAULT_TEMPERATURE,
        max_tokens: DEFAULT_MAX_TOKENS,
      }),
    });

    if (!response.ok) {
      const fallbackStatus = response.status >= 400 && response.status <= 599 ? response.status : 500;
      const contentType = response.headers.get('content-type') ?? '';
      let detail: unknown;

      if (contentType.includes('application/json')) {
        try {
          detail = await response.json();
        } catch {
          detail = await response.text();
        }
      } else {
        detail = await response.text();
      }

      return NextResponse.json(
        {
          error: 'LLM error',
          detail,
          status: response.status,
          statusText: response.statusText,
        },
        { status: fallbackStatus },
      );
    }

    const data = (await response.json()) as OpenAIChatCompletion;
    const text = data?.choices?.[0]?.message?.content ?? '';

    return NextResponse.json({ text });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const isConfigError = detail.startsWith('Missing required environment variable');

    return NextResponse.json(
      { error: isConfigError ? 'Configuration error' : 'Network error', detail },
      { status: isConfigError ? 500 : 504 },
    );
  }
}
