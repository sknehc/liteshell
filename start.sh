#!/bin/sh
echo "启动后端服务..."
cd /app/backend
node server.js &

echo "启动前端静态服务器..."
cd /app/frontend
serve -s dist -l 5173 --no-request-logging --no-update-notifier &

wait