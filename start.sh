#!/bin/sh
echo "启动 liteshell 服务..."
cd /app/backend
node server.js &
cd /app/frontend
npx vite preview --host 0.0.0.0 --port 5173 &
wait