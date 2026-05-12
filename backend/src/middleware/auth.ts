import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth.js";
import { prisma } from "../lib/db.js";

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
  };
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: "Invalid token" });
  }

  // 检查用户是否存在
  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: { id: true, email: true, role: true, status: true },
  });

  if (!user || user.status !== "active") {
    return res.status(401).json({ error: "User not found or banned" });
  }

  req.user = { userId: user.id, email: user.email, role: user.role };
  next();
}
