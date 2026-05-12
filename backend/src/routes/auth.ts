import { Router } from "express";
import { prisma } from "../lib/db.js";
import { hashPassword, comparePassword, signToken } from "../lib/auth.js";

const router = Router();

// 注册
router.post("/register", async (req, res) => {
  try {
    const { email, password, nickname } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "邮箱和密码不能为空" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "该邮箱已被注册" });
    }

    const user = await prisma.user.create({
      data: {
        email,
        password: hashPassword(password),
        nickname: nickname || email.split("@")[0],
      },
      select: { id: true, email: true, nickname: true, role: true, createdAt: true },
    });

    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    res.json({ user, token });
  } catch (error: any) {
    console.error("Register error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 登录
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "邮箱和密码不能为空" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "邮箱或密码错误" });
    }

    if (user.status !== "active") {
      return res.status(403).json({ error: "账户已被禁用" });
    }

    const valid = comparePassword(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: "邮箱或密码错误" });
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        role: user.role,
      },
      token,
    });
  } catch (error: any) {
    console.error("Login error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 获取当前用户信息
router.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { verifyToken } = await import("../lib/auth.js");
    const decoded = verifyToken(authHeader.slice(7));
    if (!decoded) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, nickname: true, role: true, createdAt: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
