import OpenAI from "openai";
import { ChatRequest } from "../types/index.js";

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  return new OpenAI({ apiKey: key });
}

export async function* streamOpenAI(request: ChatRequest) {
  const openai = getClient();
  const stream = await openai.chat.completions.create({
    model: request.model,
    messages: request.messages as any,
    stream: true,
    temperature: request.temperature ?? 0.7,
    max_tokens: request.max_tokens,
  });

  for await (const chunk of stream) {
    yield chunk;
  }
}

export async function chatOpenAI(request: ChatRequest) {
  const openai = getClient();
  const completion = await openai.chat.completions.create({
    model: request.model,
    messages: request.messages as any,
    stream: false,
    temperature: request.temperature ?? 0.7,
    max_tokens: request.max_tokens,
  });

  return completion;
}
