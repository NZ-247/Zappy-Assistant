/** Test the same authenticated endpoints used by the PM2 apps before startup. */
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import Redis from "ioredis";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const required = ["DATABASE_URL", "REDIS_URL", "ADMIN_API_TOKEN"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Precheck failed: missing ${missing.join(", ")}`);
  process.exit(1);
}

const waitArg = process.argv[2];
const waitSeconds = waitArg?.startsWith("--wait=") ? Number(waitArg.slice(7)) : waitArg === undefined ? 0 : NaN;
if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 600 || process.argv.length > 3) {
  console.error("Usage: node scripts/check-infra.mjs [--wait=SECONDS]");
  process.exit(2);
}

async function checkPostgres() {
  let prisma;
  try {
    const url = new URL(process.env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return false;
    url.searchParams.set("connect_timeout", "3");
    url.searchParams.set("socket_timeout", "3");
    prisma = new PrismaClient({ datasourceUrl: url.toString() });
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await prisma?.$disconnect();
  }
}

async function checkRedis() {
  let redis;
  try {
    const url = new URL(process.env.REDIS_URL);
    if (!["redis:", "rediss:"].includes(url.protocol)) return false;
    redis = new Redis(url.toString(), {
      lazyConnect: true,
      connectTimeout: 3_000,
      commandTimeout: 3_000,
      retryStrategy: () => null,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false
    });
    redis.on("error", () => {});
    // Send PING after authentication, with a bound even if a socket stays open.
    const connected = await Promise.race([
      redis.connect().then(() => true),
      delay(3_000, false, { ref: false })
    ]);
    return connected && (await redis.ping()) === "PONG";
  } catch {
    return false;
  } finally {
    redis?.disconnect();
  }
}

const deadline = performance.now() + waitSeconds * 1_000;
let previous;
do {
  const [postgres, redis] = await Promise.all([checkPostgres(), checkRedis()]);
  const status = `PostgreSQL=${postgres ? "ready" : "unavailable"} Redis=${redis ? "ready" : "unavailable"}`;
  if (status !== previous) console.log(`Zappy precheck: ${status}`);
  if (postgres && redis) process.exit(0);
  previous = status;
  const remaining = deadline - performance.now();
  if (remaining <= 0) break;
  await delay(Math.min(2_000, remaining));
} while (true);

process.exitCode = 1;
