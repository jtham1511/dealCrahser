export const runtime = 'edge';
export const preferredRegion = ['sin1', 'hkg1', 'bom1'];

import { NextRequest, NextResponse } from 'next/server';

type ChatRequestBody = {
  message?: unknown;
};

type OpenAIChatCompletion = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

function validateEnv(variable: string, value: string | undefined): asserts value is string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${variable}`);
  }
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const userMessage = typeof body?.message === 'string' && body.message.trim().length > 0
    ? body.message
    : 'Hello';

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

    validateEnv('OPENAI_API_KEY', apiKey);

    const url = 'https://api.openai.com/v1/chat/completions';

    const response = await fetch(url, {
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
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json({ error: 'LLM error', detail }, { status: 500 });
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
