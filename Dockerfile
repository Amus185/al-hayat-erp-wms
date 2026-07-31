# Dockerfile for Railway Node.js Deployment
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY backend/package*.json ./
RUN npm install --omit=dev

COPY backend/src ./src
COPY backend/tsconfig.json ./

EXPOSE 3000

CMD ["npx", "tsx", "src/server.ts"]
