     1|import express from "express";
     2|import cors from "cors";
     3|import helmet from "helmet";
     4|import morgan from "morgan";
     5|import dotenv from "dotenv";
     6|import rateLimit from "express-rate-limit";
     7|
     8|import chatRoutes from "./routes/chat.js";
     9|import authRoutes from "./routes/auth.js";
    10|import conversationRoutes from "./routes/conversation.js";
    11|import { errorHandler } from "./middleware/errorHandler.js";
    12|
    13|dotenv.config();
    14|
    15|const app = express();
    16|const PORT = process.env.PORT || 4000;
    17|
    18|// 安全中间件
    19|app.use(helmet());
    20|app.use(cors({
    21|  origin: process.env.FRONTEND_URL || "http://localhost:3000",
    22|  credentials: true,
    23|}));
    24|
    25|// 日志
    26|app.use(morgan("dev"));
    27|
    28|// 限流
    29|const limiter = rateLimit({
    30|  windowMs: 1 * 60 * 1000, // 1 分钟
    31|  max: 60,
    32|  message: { error: "请求过于频繁，请稍后重试" },
    33|});
    34|app.use(limiter);
    35|
    36|// 解析 JSON
    37|app.use(express.json({ limit: "10mb" }));
    38|
    39|// 健康检查
    40|app.get("/health", (_req, res) => {
    41|  res.json({ status: "ok", timestamp: new Date().toISOString() });
    42|});
    43|
    44|// API 路由
    45|app.use("/api", chatRoutes);
    46|app.use("/api/auth", authRoutes);
    47|app.use("/api/conversations", conversationRoutes);
    48|
    49|// 错误处理
    50|app.use(errorHandler);
    51|
    52|// 404
    53|app.use((_req, res) => {
    54|  res.status(404).json({ error: "Not found" });
    55|});
    56|
    57|app.listen(PORT, "0.0.0.0", () => {
    58|  console.log(`🚀 AI Space API Gateway running on port ${PORT}`);
    59|  console.log(`📋 Health check: http://localhost:${PORT}/health`);
    60|  console.log(`💬 Chat API:      http://localhost:${PORT}/api/chat`);
    61|  console.log(`🔐 Auth API:      http://localhost:${PORT}/api/auth`);
    62|});
    63|