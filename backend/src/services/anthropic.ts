import Anthropic from "@anthropic-ai/sdk";
import { ChatRequest } from "../types/index.js";

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey: key });
}

export async function* streamAnthropic(request: ChatRequest) {
  const anthropic = getClient();
  const stream = await anthropic.messages.create({
    model: request.model,
    max_tokens: request.max_tokens ?? 4096,
    messages: request.messages.map((m) => ({
      role: m.role === "system" ? "assistant" : m.role,
      content: m.content,
    })) as any,
    stream: true,
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta") {
      yield {
        choices: [{
          delta: {
            content: (event.delta as any).text || "",
          },
        }],
      };
    }
  }
}

export async function chatAnthropic(request: ChatRequest) {
  const anthropic = getClient();
  const message = await anthropic.messages.create({
    model: request.model,
    max_tokens: request.max_tokens ?? 4096,
    messages: request.messages.map((m) => ({
      role: m.role === "system" ? "assistant" : m.role,
      content: m.content,
    })) as any,
  });

  return {
    choices: [{
      message: {
        role: "assistant",
        content: (message.content[0] as any).text || "",
      },
    }],
  };
}
