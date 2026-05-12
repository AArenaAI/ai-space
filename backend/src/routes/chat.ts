import { Router, Request, Response } from "express";
import { ChatRequest, getModelConfig } from "../types/index.js";
import { streamOpenAI } from "../services/openai.js";
import { streamAnthropic, chatAnthropic } from "../services/anthropic.js";
import { streamDeepSeek, chatDeepSeek } from "../services/deepseek.js";
import { streamGemini, chatGemini } from "../services/gemini.js";
import { streamMoonshot, chatMoonshot } from "../services/moonshot.js";

const router = Router();

router.post("/chat", async (req: Request, res: Response) => {
  try {
    const body = req.body as ChatRequest;
    const { model, messages, stream = true } = body;

    if (!model || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const config = getModelConfig(model);
    if (!config) {
      return res.status(400).json({ error: `Unsupported model: ${model}` });
    }

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      try {
        switch (config.provider) {
          case "openai":
            for await (const chunk of streamOpenAI({ ...body, model: config.apiModelId })) {
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
            break;
          case "anthropic":
            for await (const chunk of streamAnthropic({ ...body, model: config.apiModelId })) {
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
            break;
          case "deepseek":
            for await (const chunk of streamDeepSeek({ ...body, model: config.apiModelId })) {
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
            break;
          case "google":
            for await (const chunk of streamGemini({ ...body, model: config.apiModelId })) {
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
            break;
          case "moonshot":
            for await (const chunk of streamMoonshot({ ...body, model: config.apiModelId })) {
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
            break;
          default:
            throw new Error(`Provider ${config.provider} not implemented`);
        }

        res.write("data: [DONE]\n\n");
        res.end();
      } catch (error: any) {
        console.error("Stream error:", error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    } else {
      // 非流式请求
      let result;
      switch (config.provider) {
        case "openai":
          result = await import("../services/openai").then((m) =>
            m.chatOpenAI({ ...body, model: config.apiModelId })
          );
          break;
        case "anthropic":
          result = await chatAnthropic({ ...body, model: config.apiModelId });
          break;
        case "deepseek":
          result = await chatDeepSeek({ ...body, model: config.apiModelId });
          break;
        case "google":
          result = await chatGemini({ ...body, model: config.apiModelId });
          break;
        case "moonshot":
          result = await chatMoonshot({ ...body, model: config.apiModelId });
          break;
        default:
          throw new Error(`Provider ${config.provider} not implemented`);
      }
      res.json(result);
    }
  } catch (error: any) {
    console.error("Chat error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 获取支持的模型列表
router.get("/models", (_req: Request, res: Response) => {
  const { SUPPORTED_MODELS } = require("../types");
  res.json({ models: SUPPORTED_MODELS });
});

export default router;
