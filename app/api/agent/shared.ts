export type ChatRequestBody = {
  message?: unknown;
};

export const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
export const DEFAULT_MODEL = 'gpt-4o-mini';
export const DEFAULT_TEMPERATURE = 0.2;
export const DEFAULT_MAX_TOKENS = 600;
export const SYSTEM_PROMPT = 'You are a helpful assistant for a Singapore Government analysis portal.';

export function validateEnv(variable: string, value: string | undefined): asserts value is string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${variable}`);
  }
}

export function getUserMessage(body: ChatRequestBody | undefined, fallback: string): string {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  return message.length > 0 ? message : fallback;
}

export function buildMessages(userMessage: string) {
  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: userMessage },
  ];
}