FROM node:20-alpine

WORKDIR /app

# 复制依赖文件
COPY package*.json ./
RUN npm ci --production

# 复制构建产物
COPY dist ./dist
COPY prisma ./prisma

# 生成 Prisma Client
RUN npx prisma generate

# 创建数据目录
RUN mkdir -p data

EXPOSE 4000

CMD ["node", "dist/index.js"]
