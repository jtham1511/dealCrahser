import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';

import { POST as chatPOST } from '../app/api/agent/route';
import { POST as streamPOST } from '../app/api/agent/stream/route';

const ORIGINAL_FETCH = globalThis.fetch;
const encoder = new TextEncoder();

if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis;
}

function createStreamingResponse(chunks, init) {
  const stream = new ReadableStream({
    start(controller) {
      let index = 0;
      const push = () => {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[index++]));
        queueMicrotask(push);
      };
      push();
    },
  });

  return new Response(stream, init);
}

function createJsonResponse(json, init) {
  return new Response(JSON.stringify(json), {
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
  });
}

async function run() {
  process.env.OPENAI_API_KEY = 'test-key';

  globalThis.fetch = async (_input, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    if (body.stream) {
      return createStreamingResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ], {
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
        statusText: 'OK',
      });
    }

    return createJsonResponse({
      choices: [
        {
          message: {
            content: 'Hello world',
          },
        },
      ],
    });
  };

  try {
    await testChatEndpoint();
    await testStreamEndpoint();
    console.log('All agent endpoint tests passed');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
}

async function testChatEndpoint() {
  const request = new NextRequest('http://localhost/api/agent', {
    method: 'POST',
    body: JSON.stringify({ message: 'Hello' }),
  });

  const response = await chatPOST(request);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.text, 'Hello world');
}

async function testStreamEndpoint() {
  const request = new NextRequest('http://localhost/api/agent/stream', {
    method: 'POST',
    body: JSON.stringify({ message: 'Hello' }),
  });

  const response = await streamPOST(request);
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert(reader, 'expected response to include a readable body');
  const decoder = new TextDecoder();
  let buffer = '';
  let received = '';
  let doneEvent = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n\n');
    buffer = lines.pop() ?? '';

    for (const chunk of lines) {
      if (chunk.startsWith('event: done')) {
        doneEvent = true;
        continue;
      }
      if (!chunk.startsWith('data:')) {
        continue;
      }
      const json = JSON.parse(chunk.slice(5).trim());
      if (json.text) {
        received += json.text;
      }
    }
  }

  if (buffer.startsWith('data:')) {
    const json = JSON.parse(buffer.slice(5).trim());
    if (json.text) {
      received += json.text;
    }
  }

  assert.equal(received, 'Hello world');
  assert(doneEvent, 'expected done event to be emitted');
}

await run();
