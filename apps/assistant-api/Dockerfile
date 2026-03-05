FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY tsconfig.base.json ./
COPY prisma ./prisma
COPY packages ./packages
COPY apps/assistant-api ./apps/assistant-api
RUN npm install
RUN npm run prisma:generate
RUN npm run build -w @zappy/shared && npm run build -w @zappy/adapters && npm run build -w @zappy/assistant-api
CMD ["npm", "run", "start", "-w", "@zappy/assistant-api"]
