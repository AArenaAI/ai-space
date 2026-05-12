import { GoogleGenerativeAI } from "@google/generative-ai";
import { ChatRequest } from "../types/index.js";

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  return new GoogleGenerativeAI(key);
}

export async function* streamGemini(request: ChatRequest) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: request.model });

  const history = request.messages.slice(0, -1).map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });
  const lastMessage = request.messages[request.messages.length - 1];

  const result = await chat.sendMessageStream(lastMessage.content);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    yield {
      choices: [{
        delta: { content: text },
      }],
    };
  }
}

export async function chatGemini(request: ChatRequest) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: request.model });

  const history = request.messages.slice(0, -1).map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });
  const lastMessage = request.messages[request.messages.length - 1];

  const result = await chat.sendMessage(lastMessage.content);
  const text = result.response.text();

  return {
    choices: [{
      message: { role: "assistant", content: text },
    }],
  };
}
