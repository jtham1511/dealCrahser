export const runtime = 'edge';
export const preferredRegion = ['sin1', 'hkg1', 'bom1'];

import { NextRequest } from 'next/server';


import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
  DEFAULT_TEMPERATURE,
  OPENAI_CHAT_URL,
  buildMessages,
  getUserMessage,
  type ChatRequestBody,
  validateEnv,
} from '../shared';


type OpenAIErrorDetail = unknown;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
} as const;

function formatSSE(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function readErrorDetail(response: Response): Promise<OpenAIErrorDetail> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return await response.text();
    }
  }

  return await response.text();
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

    validateEnv('OPENAI_API_KEY', apiKey);

    let upstream: Response;

    try {
      upstream = await fetch(OPENAI_CHAT_URL, {
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
        try {
          let buffer = '';

          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }