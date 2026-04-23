import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { createLogger } from "@zappy/shared";

export interface AdminUiServerConfig {
  port: number;
  defaultAdminApiBaseUrl: string;
}

const parsePort = (raw: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(raw ?? String(fallback), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const tryNormalizeBaseUrl = (raw: string | undefined): string | null => {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!parsed.protocol.startsWith("http")) return null;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const normalizeBaseUrl = (raw: string | undefined): string => {
  const fallback = `http://localhost:${parsePort(process.env.ADMIN_API_PORT, 3333)}`;
  return tryNormalizeBaseUrl(raw) ?? fallback;
};

export const resolveAdminUiConfig = (): AdminUiServerConfig => ({
  port: parsePort(process.env.ADMIN_UI_PORT, 8080),
  defaultAdminApiBaseUrl: normalizeBaseUrl(process.env.ADMIN_API_BASE_URL)
});

const shouldSendBody = (method: string): boolean => ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());

const buildUpstreamBody = (method: string, body: unknown): { payload?: BodyInit; contentType?: string } => {
  if (!shouldSendBody(method) || body === undefined || body === null) return {};
  if (typeof body === "string") {
    return {
      payload: body,
      contentType: "text/plain"
    };
  }

  return {
    payload: JSON.stringify(body),
    contentType: "application/json"
  };
};

const safeReadJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
};

export const createAdminUiServer = async (configInput: Partial<AdminUiServerConfig> = {}) => {
  const defaults = resolveAdminUiConfig();
  const config: AdminUiServerConfig = {
    port: configInput.port ?? defaults.port,
    defaultAdminApiBaseUrl: configInput.defaultAdminApiBaseUrl ?? defaults.defaultAdminApiBaseUrl
  };

  const logger = createLogger("admin-ui");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const publicDir = join(__dirname, "../public");

  const app = Fastify({ loggerInstance: logger });

  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/"
  });

  app.get("/ui-config", async () => ({
    schemaVersion: "admin.ui.config.v1",
    defaultAdminApiBaseUrl: config.defaultAdminApiBaseUrl,
    uiVersion: "1.9.2"
  }));

  app.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/ui-api/*",
    handler: async (request, reply) => {
      const wildcardPath = ((request.params as { "*"?: string })["*"] ?? "").replace(/^\/+/, "");
      const queryIndex = request.url.indexOf("?");
      const querySuffix = queryIndex >= 0 ? request.url.slice(queryIndex) : "";

      const headerBaseUrl = typeof request.headers["x-admin-api-base"] === "string" ? request.headers["x-admin-api-base"] : undefined;
      const normalizedHeaderBaseUrl = headerBaseUrl ? tryNormalizeBaseUrl(headerBaseUrl) : null;
      if (headerBaseUrl && !normalizedHeaderBaseUrl) {
        return reply.code(400).send({
          error: {
            code: "INVALID_API_BASE_URL",
            message: "Invalid admin-api base URL. Use a valid http(s) URL."
          }
        });
      }
      const upstreamBaseUrl = normalizedHeaderBaseUrl ?? config.defaultAdminApiBaseUrl;
      const upstreamUrl = `${upstreamBaseUrl}/${wildcardPath}${querySuffix}`;

      const tokenHeader = typeof request.headers["x-admin-token"] === "string" ? request.headers["x-admin-token"] : "";
      const authorizationHeader = typeof request.headers.authorization === "string" ? request.headers.authorization : "";
      const bearerToken = tokenHeader.trim() || authorizationHeader.replace(/^Bearer\s+/i, "").trim();

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 10_000);

      try {
        const body = buildUpstreamBody(request.method, request.body);
        const upstreamResponse = await fetch(upstreamUrl, {
          method: request.method,
          headers: {
            ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
            ...(body.contentType ? { "Content-Type": body.contentType } : {})
          },
          body: body.payload,
          signal: abortController.signal
        });
        clearTimeout(timeout);

        const contentType = upstreamResponse.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
          const payload = await safeReadJson(upstreamResponse);
          return reply.code(upstreamResponse.status).send(payload ?? null);
        }

        const textBody = await upstreamResponse.text();
        if (!textBody) return reply.code(upstreamResponse.status).send(null);
        return reply.code(upstreamResponse.status).type(contentType || "text/plain").send(textBody);
      } catch (error) {
        clearTimeout(timeout);
        logger.warn(
          {
            route: "/ui-api/*",
            method: request.method,
            upstreamUrl,
            error: toErrorMessage(error)
          },
          "admin-ui proxy upstream request failed"
        );
        return reply.code(502).send({
          error: {
            code: "UPSTREAM_UNAVAILABLE",
            message: "Could not reach admin-api. Verify base URL/network and try again.",
            details: {
              upstreamUrl,
              reason: toErrorMessage(error)
            }
          }
        });
      }
    }
  });

  app.get("/", (_, reply) => reply.sendFile("index.html"));
  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split("?")[0] ?? "/";
    if (pathname.startsWith("/ui-api") || pathname === "/ui-config") {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found" } });
    }
    return reply.type("text/html").sendFile("index.html");
  });

  const start = async () => {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    logger.info({ port: config.port, apiBase: config.defaultAdminApiBaseUrl }, "admin-ui started");
  };

  return {
    app,
    config,
    start,
    close: () => app.close()
  };
};

const isEntrypoint = resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const server = await createAdminUiServer();
  void server.start();
}
