FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY tsconfig.base.json ./
COPY prisma ./prisma
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN npm install
RUN npm run prisma:generate
RUN npm run build -w @zappy/shared && npm run build -w @zappy/adapters && npm run build -w @zappy/worker
CMD ["npm", "run", "start", "-w", "@zappy/worker"]
