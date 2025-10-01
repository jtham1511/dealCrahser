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
  process.env.OPENAI_ORGANIZATION = 'org-test';
  process.env.OPENAI_PROJECT_ID = 'proj-test';

  globalThis.fetch = async (_input, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer test-key');
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(headers.get('openai-organization'), 'org-test');
    assert.equal(headers.get('openai-project'), 'proj-test');
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

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const { event, data } = parseSSEFrame(frame);
      if (event === 'done') {
        doneEvent = true;
        continue;
      }
      if (event !== 'message' || !data) {
        continue;
      }
      const json = JSON.parse(data);
      if (json.text) {
        received += json.text;
      }
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    const { event, data } = parseSSEFrame(trailing);
    if (event === 'message' && data) {
      const json = JSON.parse(data);
      if (json.text) {
        received += json.text;
      }
    }
    if (event === 'done') {
      doneEvent = true;
    }
  }

  assert.equal(received, 'Hello world');
  assert(doneEvent, 'expected done event to be emitted');
}

function parseSSEFrame(frame) {
  let event = 'message';
  const dataLines = [];

  for (const rawLine of frame.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  return { event, data: dataLines.length > 0 ? dataLines.join('\n') : undefined };
}

await run();
