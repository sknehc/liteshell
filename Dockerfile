# 阶段1：构建前端
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# 阶段2：最终镜像
FROM node:22-alpine
WORKDIR /app

# 设置环境变量：后端监听 5173 端口
ENV NODE_ENV=production
ENV PORT=5173

# 复制后端代码
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production
COPY backend/ ./backend

# 复制前端构建产物到后端静态目录
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# 创建数据目录（用于存储配置文件）
RUN mkdir -p /app/data && chmod 755 /app/data

# 暴露 5173 端口
EXPOSE 5173

# 启动后端服务（同时托管前端）
CMD ["node", "backend/server.js"]