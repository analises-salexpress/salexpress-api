FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci && npx prisma generate

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

EXPOSE 3000

CMD ["node", "dist/server.js"]
