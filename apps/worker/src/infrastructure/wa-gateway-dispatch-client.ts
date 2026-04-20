import {
  INTERNAL_GATEWAY_SEND_TEXT_PATH,
  internalGatewaySendTextRequestSchema,
  internalGatewaySendTextSuccessSchema,
  type InternalGatewaySendTextRequest
} from "@zappy/shared";
import { withCategory } from "@zappy/shared";

type LoggerLike = {
  debug?: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

export interface WaGatewayDispatchClient {
  sendText: (input: InternalGatewaySendTextRequest) => Promise<{
    dispatchAccepted: true;
    sendStatus: "sent";
    waMessageId: string;
    raw?: unknown;
  }>;
}

export interface WaGatewayDispatchClientInput {
  baseUrl: string;
  token: string;
  logger: LoggerLike;
}

const parseJson = (raw: string): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const createWaGatewayDispatchClient = (input: WaGatewayDispatchClientInput): WaGatewayDispatchClient => {
  const endpoint = new URL(INTERNAL_GATEWAY_SEND_TEXT_PATH, input.baseUrl).toString();

  return {
    sendText: async (payload) => {
      const requestPayload = internalGatewaySendTextRequestSchema.parse(payload);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(requestPayload)
      });

      const rawBody = await response.text();
      const responseBody = parseJson(rawBody);

      if (!response.ok) {
        input.logger.warn(
          withCategory("HTTP", {
            route: INTERNAL_GATEWAY_SEND_TEXT_PATH,
            method: "POST",
            status: response.status,
            tenantId: requestPayload.tenantId,
            action: requestPayload.action,
            referenceId: requestPayload.referenceId,
            responseBody
          }),
          "gateway dispatch request failed"
        );
        throw new Error(`gateway_dispatch_failed:${response.status}`);
      }

      const parsed = internalGatewaySendTextSuccessSchema.safeParse(responseBody);
      if (!parsed.success) {
        throw new Error("gateway_dispatch_invalid_response");
      }

      input.logger.debug?.(
        withCategory("HTTP", {
          route: INTERNAL_GATEWAY_SEND_TEXT_PATH,
          method: "POST",
          status: response.status,
          tenantId: requestPayload.tenantId,
          action: requestPayload.action,
          referenceId: requestPayload.referenceId,
          dispatchAccepted: parsed.data.dispatchAccepted,
          sendStatus: parsed.data.sendStatus,
          waMessageId: parsed.data.waMessageId,
          errorCode: parsed.data.errorCode
        }),
        "gateway dispatch accepted"
      );

      if (parsed.data.sendStatus !== "sent" || !parsed.data.waMessageId) {
        throw new Error(
          `gateway_send_failed:${parsed.data.errorCode ?? parsed.data.errorMessage ?? "unknown_send_failure"}`
        );
      }

      input.logger.debug?.(
        withCategory("HTTP", {
          route: INTERNAL_GATEWAY_SEND_TEXT_PATH,
          method: "POST",
          status: response.status,
          tenantId: requestPayload.tenantId,
          action: requestPayload.action,
          referenceId: requestPayload.referenceId,
          dispatchAccepted: parsed.data.dispatchAccepted,
          sendStatus: parsed.data.sendStatus,
          waMessageId: parsed.data.waMessageId
        }),
        "gateway dispatch request succeeded"
      );

      return {
        dispatchAccepted: parsed.data.dispatchAccepted,
        sendStatus: parsed.data.sendStatus,
        waMessageId: parsed.data.waMessageId,
        raw: parsed.data.raw
      };
    }
  };
};
