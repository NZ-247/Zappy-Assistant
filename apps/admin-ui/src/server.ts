import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createLogger } from "@zappy/shared";

const env = {
  ADMIN_UI_PORT: Number(process.env.ADMIN_UI_PORT ?? 8080),
  ADMIN_API_BASE_URL: process.env.ADMIN_API_BASE_URL ?? "http://localhost:3333"
};
const logger = createLogger("admin-ui");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = Fastify({ loggerInstance: logger });

await app.register(fastifyStatic, {
  root: join(__dirname, "../public"),
  prefix: "/"
});

app.get("/", (_, reply) => reply.sendFile("index.html"));
app.get("/triggers", (_, reply) => reply.sendFile("triggers.html"));
app.get("/logs", (_, reply) => reply.sendFile("logs.html"));
app.post(
  "/inform",
  { logLevel: "silent" },
  async (_request, reply) => reply.status(204).send()
);

const start = async () => {
  await app.listen({ port: env.ADMIN_UI_PORT, host: "0.0.0.0" });
  logger.info({ port: env.ADMIN_UI_PORT, apiBase: env.ADMIN_API_BASE_URL }, "admin-ui started");
};

void start();
