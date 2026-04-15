import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  INTERNAL_MEDIA_RESOLVER_RESOLVE_PATH,
  mediaResolverResolveRequestSchema,
  mediaResolverResolveSuccessSchema,
  type MediaResolverResolveRequest,
  type MediaResolverResolveResult
} from "@zappy/shared";

type LoggerLike = {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
};

export interface InternalMediaResolverApiDeps {
  port: number;
  token: string;
  logger?: LoggerLike;
  resolveMedia: (request: MediaResolverResolveRequest) => Promise<MediaResolverResolveResult>;
}

const parseBearerToken = (authorizationHeader?: string | string[]): string | null => {
  if (!authorizationHeader) return null;
  const value = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice("Bearer ".length).trim() || null;
};

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
};

const writeJson = (reply: ServerResponse<IncomingMessage>, status: number, payload: unknown) => {
  reply.statusCode = status;
  reply.setHeader("content-type", "application/json; charset=utf-8");
  reply.end(JSON.stringify(payload));
};

export const startInternalMediaResolverApi = (deps: InternalMediaResolverApiDeps) => {
  const server = createServer(async (request, reply) => {
    const method = request.method ?? "GET";
    const path = request.url ? new URL(request.url, "http://localhost").pathname : "/";

    if (method === "GET" && path === "/health") {
      writeJson(reply, 200, {
        ok: true,
        service: "media-resolver-api",
        checkedAt: new Date().toISOString()
      });
      return;
    }

    if (method !== "POST" || path !== INTERNAL_MEDIA_RESOLVER_RESOLVE_PATH) {
      writeJson(reply, 404, { ok: false, error: "Not found", code: "NOT_FOUND" });
      return;
    }

    const token = parseBearerToken(request.headers.authorization);
    if (token !== deps.token) {
      deps.logger?.warn?.(
        {
          capability: "downloads",
          status: "resolver_unauthorized",
          route: INTERNAL_MEDIA_RESOLVER_RESOLVE_PATH,
          method,
          httpStatus: 401
        },
        "media resolver unauthorized request"
      );
      writeJson(reply, 401, { ok: false, error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    let bodyRaw = "";
    try {
      bodyRaw = await readBody(request);
    } catch (error) {
      deps.logger?.warn?.(
        {
          capability: "downloads",
          status: "resolver_invalid_body",
          route: INTERNAL_MEDIA_RESOLVER_RESOLVE_PATH,
          error
        },
        "media resolver invalid request body"
      );
      writeJson(reply, 400, { ok: false, error: "Invalid body", code: "INVALID_BODY" });
      return;
    }

    const json = (() => {
      try {
        return bodyRaw ? JSON.parse(bodyRaw) : {};
      } catch {
        return null;
      }
    })();

    if (!json) {
      writeJson(reply, 400, { ok: false, error: "Invalid JSON", code: "INVALID_JSON" });
      return;
    }

    const parsed = mediaResolverResolveRequestSchema.safeParse(json);
    if (!parsed.success) {
      writeJson(reply, 400, {
        ok: false,
        error: "Invalid payload",
        code: "INVALID_PAYLOAD",
        issues: parsed.error.issues
      });
      return;
    }

    try {
      const result = await deps.resolveMedia(parsed.data);
      const payload = {
        ok: true as const,
        result
      };
      const validated = mediaResolverResolveSuccessSchema.parse(payload);

      deps.logger?.info?.(
        {
          capability: "downloads",
          status: "resolver_ok",
          route: INTERNAL_MEDIA_RESOLVER_RESOLVE_PATH,
          provider: validated.result.provider,
          resultStatus: validated.result.status,
          resultKind: validated.result.resultKind,
          tenantId: parsed.data.tenantId,
          jobId: validated.result.jobId
        },
        "media resolver request succeeded"
      );

      writeJson(reply, 200, validated);
    } catch (error) {
      deps.logger?.error?.(
        {
          capability: "downloads",
          status: "resolver_failed",
          route: INTERNAL_MEDIA_RESOLVER_RESOLVE_PATH,
          tenantId: parsed.data.tenantId,
          error
        },
        "media resolver request failed"
      );
      writeJson(reply, 500, {
        ok: false,
        error: "Resolve failed",
        code: "RESOLVE_FAILED"
      });
    }
  });

  server.listen(deps.port, "0.0.0.0", () => {
    deps.logger?.info?.(
      {
        capability: "downloads",
        status: "resolver_api_started",
        route: INTERNAL_MEDIA_RESOLVER_RESOLVE_PATH,
        port: deps.port
      },
      "media resolver api started"
    );
  });

  return {
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
};
