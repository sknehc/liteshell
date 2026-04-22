FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app

RUN npm install -g http-server

COPY backend/package*.json ./backend/
RUN cd backend && npm install --production
COPY backend/ ./backend

COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

COPY start.sh ./
RUN chmod +x ./start.sh

EXPOSE 5173
CMD ["/app/start.sh"]