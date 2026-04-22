#!/bin/sh
echo "启动后端服务..."
cd /app/backend
node server.js &

echo "启动前端静态服务器..."
cd /app/frontend
http-server dist -p 5173 --silent &

wait