export const runtime='edge';
export const preferredRegion=['sin1','hkg1','bom1'];
import { NextRequest } from 'next/server';
export async function POST(req: NextRequest) {
  const { message } = await req.json();
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  if (!apiKey || !model) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({ detail: 'Missing required environment variables for OpenAI' })}\n\n`,
      {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
        status: 500,
      },
    );
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller){
      try{
        const url = 'https://api.openai.com/v1/chat/completions';
        const resp = await fetch(url, { method:'POST', headers:{ 'content-type':'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages:[{role:'system',content:'You are a helpful assistant for a Singapore Government analysis portal.'},{role:'user',content: message||'Hello'}], temperature:0.2, max_tokens:600, stream:true }) });
        if(!resp.ok || !resp.body){ const detail = await resp.text(); controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ detail })}\n\n`)); controller.close(); return; }
        const reader = resp.body.getReader(); const decoder = new TextDecoder(); let buffer='';
        while(true){ const { value, done } = await reader.read(); if(done) break; buffer += decoder.decode(value, { stream:true });
          const lines = buffer.split('\n'); buffer = lines.pop() || '';
          for(const raw of lines){ const line = raw.trim(); if(!line.startsWith('data:')) continue; const data = line.slice(5).trim();
            if(data==='[DONE]'){ controller.enqueue(encoder.encode('event: done\ndata: {}\n\n')); controller.close(); return; }
            try{ const obj = JSON.parse(data); const delta = obj?.choices?.[0]?.delta?.content; if(delta){ controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`)); } }catch{}
          }
        }
        controller.close();
      }catch(e){ controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ detail:String(e) })}\n\n`)); controller.close(); }
    }
  });
  return new Response(stream, { headers:{ 'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-cache, no-transform', 'Connection':'keep-alive' } });
}
