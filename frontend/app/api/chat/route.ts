import { NextRequest } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 转发到后端服务：必须透传完整 body。
    // /api/chat 支持 conversation_id、message_file_ids、context_file_ids、context_policy、skill_key 等字段；
    // 如果这里只转 model/messages，Seedream/Notebook/附件上下文都会被静默丢失。
    const backendUrl = process.env.BACKEND_URL || process.env.NEXT_DEV_API_PROXY_TARGET || "http://localhost:9091";
    const response = await fetch(`${backendUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: req.headers.get("authorization") || "",
        "X-Guest-ID": req.headers.get("x-guest-id") || "",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return new Response(error, { status: response.status });
    }

    // 流式转发
    return new Response(response.body, {
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
