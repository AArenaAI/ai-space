import { ChatRequest } from "../types";

const MOONSHOT_API_URL = "https://api.moonshot.cn/v1/chat/completions";

export async function* streamMoonshot(request: ChatRequest) {
  const response = await fetch(MOONSHOT_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MOONSHOT_API_KEY}`,
    },
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      stream: true,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens,
    }),
  });

  if (!response.ok) {
    throw new Error(`Moonshot API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No reader available");

  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          yield parsed;
        } catch {
          // ignore
        }
      }
    }
  }
}

export async function chatMoonshot(request: ChatRequest) {
  const response = await fetch(MOONSHOT_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MOONSHOT_API_KEY}`,
    },
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      stream: false,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens,
    }),
  });

  if (!response.ok) {
    throw new Error(`Moonshot API error: ${response.status}`);
  }

  return response.json();
}
