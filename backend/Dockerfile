# Dockerfile for Railway Node.js Deployment
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY tsconfig.json ./

EXPOSE 3000

CMD ["npx", "tsx", "src/server.ts"]
