# Dockerfile for Railway Node.js Deployment
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npx tsc --noEmit

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src
COPY tsconfig.json ./

EXPOSE 3000

CMD ["npx", "tsx", "src/server.ts"]
