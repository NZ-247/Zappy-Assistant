import { createLogger, loadEnv } from "@zappy/shared";

const env = loadEnv();
const logger = createLogger("wa-gateway");

const connectBaileysStub = async () => {
  logger.info({ nodeEnv: env.NODE_ENV }, "connected");
};

const shutdown = async () => {
  logger.info("shutting down wa-gateway");
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

void connectBaileysStub();
