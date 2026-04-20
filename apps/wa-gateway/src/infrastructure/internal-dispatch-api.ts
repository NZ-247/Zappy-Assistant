import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  INTERNAL_GATEWAY_SEND_TEXT_PATH,
  internalGatewaySendTextRequestSchema,
  type InternalGatewaySendTextRequest
} from "@zappy/shared";
import { withCategory } from "@zappy/shared";

type LoggerLike = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export interface InternalDispatchApiDeps {
  port: number;
  token: string;
  logger: LoggerLike;
  dispatchText: (input: InternalGatewaySendTextRequest) => Promise<{ waMessageId: string; raw?: unknown }>;
}

const summarizeError = (error: unknown): { errorName: string; operatorMessage: string } => {
  if (error instanceof Error) {
    const message = error.message.replace(/\s+/g, " ").trim();
    return {
      errorName: error.name || "Error",
      operatorMessage: message.length > 180 ? `${message.slice(0, 177)}...` : message
    };
  }
  const raw = String(error ?? "unknown_error")
    .replace(/\s+/g, " ")
    .trim();
  return {
    errorName: "UnknownError",
    operatorMessage: raw.length > 180 ? `${raw.slice(0, 177)}...` : raw
  };
};

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

export const startInternalDispatchApi = (deps: InternalDispatchApiDeps) => {
  const server = createServer(async (request, reply) => {
    const method = request.method ?? "GET";
    const path = request.url ? new URL(request.url, "http://localhost").pathname : "/";

    if (method !== "POST" || path !== INTERNAL_GATEWAY_SEND_TEXT_PATH) {
      writeJson(reply, 404, { ok: false, error: "Not found", code: "NOT_FOUND" });
      return;
    }

    const token = parseBearerToken(request.headers.authorization);
    if (token !== deps.token) {
      deps.logger.warn(withCategory("HTTP", { method, route: path, status: 401 }), "internal dispatch unauthorized");
      writeJson(reply, 401, { ok: false, error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    let bodyRaw = "";
    try {
      bodyRaw = await readBody(request);
    } catch (error) {
      deps.logger.error(withCategory("ERROR", { method, route: path, error }), "failed to read internal dispatch request body");
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

    const parsed = internalGatewaySendTextRequestSchema.safeParse(json);
    if (!parsed.success) {
      writeJson(reply, 400, {
        ok: false,
        error: "Invalid payload",
        code: "INVALID_PAYLOAD",
        issues: parsed.error.issues
      });
      return;
    }

    deps.logger.info(
      withCategory("HTTP", {
        method,
        route: path,
        status: 200,
        tenantId: parsed.data.tenantId,
        action: parsed.data.action,
        referenceId: parsed.data.referenceId,
        to: parsed.data.to,
        dispatchAccepted: true
      }),
      "internal dispatch accepted"
    );

    deps.logger.info(
      withCategory("WA-OUT", {
        action: parsed.data.action,
        tenantId: parsed.data.tenantId,
        referenceId: parsed.data.referenceId,
        waUserId: parsed.data.waUserId ?? parsed.data.to,
        waGroupId: parsed.data.waGroupId,
        to: parsed.data.to,
        status: "wa_send_attempted",
        source: "worker_internal"
      }),
      "internal dispatch attempting wa send"
    );

    try {
      const sent = await deps.dispatchText(parsed.data);
      deps.logger.info(
        withCategory("WA-OUT", {
          action: parsed.data.action,
          tenantId: parsed.data.tenantId,
          referenceId: parsed.data.referenceId,
          waUserId: parsed.data.waUserId ?? parsed.data.to,
          waGroupId: parsed.data.waGroupId,
          to: parsed.data.to,
          waMessageId: sent.waMessageId,
          status: "wa_send_succeeded",
          source: "worker_internal"
        }),
        "internal dispatch wa send succeeded"
      );
      writeJson(reply, 200, {
        ok: true,
        dispatchAccepted: true,
        sendStatus: "sent",
        waMessageId: sent.waMessageId,
        raw: sent.raw
      });
    } catch (error) {
      const summarized = summarizeError(error);
      deps.logger.error(
        withCategory("ERROR", {
          method,
          route: path,
          status: 200,
          tenantId: parsed.data.tenantId,
          action: parsed.data.action,
          referenceId: parsed.data.referenceId,
          to: parsed.data.to,
          dispatchAccepted: true,
          sendStatus: "failed",
          errorName: summarized.errorName,
          operatorMessage: summarized.operatorMessage
        }),
        "internal dispatch wa send failed"
      );
      writeJson(reply, 200, {
        ok: true,
        dispatchAccepted: true,
        sendStatus: "failed",
        errorCode: "WA_SEND_FAILED",
        errorMessage: summarized.operatorMessage
      });
    }
  });

  server.listen(deps.port, "0.0.0.0", () => {
    deps.logger.info(
      withCategory("HTTP", { method: "POST", route: INTERNAL_GATEWAY_SEND_TEXT_PATH, port: deps.port }),
      "wa internal dispatch api started"
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
