FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin-ui ./apps/admin-ui
RUN npm install
RUN npm run build -w @zappy/shared && npm run build -w @zappy/admin-ui
CMD ["npm", "run", "start", "-w", "@zappy/admin-ui"]
