# 多阶段构建：前端构建 + 后端运行
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine

WORKDIR /app

# 复制后端代码和依赖
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production
COPY backend/ ./backend

# 复制前端构建产物
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# 复制启动脚本（确保 start.sh 存在于项目根目录）
COPY start.sh ./
RUN chmod +x ./start.sh

# 暴露端口
EXPOSE 5173

# 使用绝对路径执行
CMD ["/app/start.sh"]