import { Router } from "express";
import { prisma } from "../lib/db.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";

const router = Router();

// 创建会话
router.post("/conversations", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { title, model } = req.body;
    const conv = await prisma.conversation.create({
      data: {
        title: title || "新对话",
        model: model || "gpt-4o-mini",
        userId: req.user!.userId,
      },
    });
    res.json(conv);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取用户会话列表
router.get("/conversations", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const convs = await prisma.conversation.findMany({
      where: { userId: req.user!.userId },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { messages: true } } },
    });
    res.json(convs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 获取会话详情 + 消息
router.get("/conversations/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conv) return res.status(404).json({ error: "Not found" });
    res.json(conv);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 添加消息
router.post("/conversations/:id/messages", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { role, content, model } = req.body;
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    });
    if (!conv) return res.status(404).json({ error: "Not found" });

    const msg = await prisma.message.create({
      data: {
        role,
        content,
        model,
        conversationId: req.params.id,
      },
    });
    res.json(msg);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 删除会话
router.delete("/conversations/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    await prisma.conversation.deleteMany({
      where: { id: req.params.id, userId: req.user!.userId },
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
