import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
    const response = await fetch(`${backendUrl}/api/files/upload`, {
      method: "POST",
      headers: {
        Authorization: req.headers.get("authorization") || "",
        "X-Guest-ID": req.headers.get("x-guest-id") || "",
      },
      body: formData,
    });

    const responseBody = await response.text();
    return new Response(responseBody, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || "文件上传失败" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
