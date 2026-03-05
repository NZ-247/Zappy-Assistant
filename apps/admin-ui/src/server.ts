import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createLogger, loadEnv } from "@zappy/shared";

const env = loadEnv();
const logger = createLogger("admin-ui");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = Fastify({ logger });

await app.register(fastifyStatic, {
  root: join(__dirname, "../public"),
  prefix: "/"
});

app.get("/", (_, reply) => reply.sendFile("index.html"));
app.get("/triggers", (_, reply) => reply.sendFile("triggers.html"));
app.get("/logs", (_, reply) => reply.sendFile("logs.html"));

const start = async () => {
  await app.listen({ port: env.ADMIN_UI_PORT, host: "0.0.0.0" });
  logger.info({ port: env.ADMIN_UI_PORT }, "admin-ui started");
};

void start();
