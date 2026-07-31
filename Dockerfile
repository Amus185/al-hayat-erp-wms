# Root Dockerfile for Railway Node.js Deployment
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY backend/package*.json ./
RUN npm ci

COPY backend/src ./src
COPY backend/tsconfig.json ./

EXPOSE 3000

CMD ["npx", "tsx", "src/server.ts"]
