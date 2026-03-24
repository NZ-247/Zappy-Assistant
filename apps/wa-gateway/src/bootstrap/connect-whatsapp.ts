import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from "baileys";
import { Boom } from "@hapi/boom";
import qrcodeTerminal from "qrcode-terminal";

interface ConnectWhatsAppDeps {
  env: {
    WA_SESSION_PATH: string;
    WA_PAIRING_PHONE?: string;
  };
  logger: {
    info: (payload: unknown, message?: string) => void;
    warn: (payload: unknown, message?: string) => void;
  };
  baileysLogger: any;
  normalizeJid: (value: string) => string;
  setSocket: (socket: any) => void;
  setBotSelfLidKey: (botJid?: string | null) => void;
  loadBotSelfLid: () => Promise<string | null>;
  learnBotSelfLid: (candidate: string | null | undefined, reason: string) => Promise<string | null>;
  markGatewayHeartbeat: (isConnected: boolean) => Promise<void>;
  withCategory: (category: any, payload?: Record<string, unknown>) => unknown;
  wireInboundEvents: (socket: any) => void;
}

const RECONNECT_BASE_DELAY_MS = 1_500;
const RECONNECT_MAX_DELAY_MS = 20_000;
const PAIRING_CODE_COOLDOWN_MS = 30_000;

const readDisconnectStatusCode = (error: unknown): number | undefined => {
  const boom = error as Boom | undefined;
  return boom?.output?.statusCode;
};

const cleanupSocket = (socket: any | null) => {
  if (!socket) return;
  try {
    (socket.ev as { removeAllListeners?: () => void } | undefined)?.removeAllListeners?.();
  } catch {
    // best effort cleanup
  }
  try {
    (socket as { ws?: { close?: () => void } }).ws?.close?.();
  } catch {
    // best effort cleanup
  }
  try {
    (socket as { end?: (reason?: unknown) => void }).end?.("socket_replaced");
  } catch {
    // best effort cleanup
  }
};

export const createWhatsAppConnector = (deps: ConnectWhatsAppDeps) => {
  let currentSocket: any | null = null;
  let connectInFlight = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempt = 0;
  let connectionGeneration = 0;
  let lastPairingCodeRequestAt = 0;

  const clearReconnectTimer = () => {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const scheduleReconnect = (input: { reason: string; statusCode?: number }) => {
    if (reconnectTimer) return;
    reconnectAttempt += 1;
    const exponentialDelay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** Math.min(6, reconnectAttempt - 1));
    const jitterMs = Math.floor(Math.random() * 500);
    const delayMs = exponentialDelay + jitterMs;
    deps.logger.warn(
      deps.withCategory("WARN", {
        status: "WhatsApp RECONNECT_SCHEDULED",
        attempt: reconnectAttempt,
        delayMs,
        reason: input.reason,
        statusCode: input.statusCode
      }),
      "WhatsApp RECONNECT_SCHEDULED"
    );
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect("reconnect");
    }, delayMs);
  };

  const connect = async (origin: "startup" | "reconnect" = "startup") => {
    if (connectInFlight) {
      deps.logger.warn(deps.withCategory("WARN", { status: "WhatsApp CONNECT_SKIPPED_IN_FLIGHT", origin }), "WhatsApp CONNECT_SKIPPED_IN_FLIGHT");
      return;
    }

    connectInFlight = true;
    clearReconnectTimer();
    const connectionAttemptId = ++connectionGeneration;
    deps.logger.info(
      deps.withCategory("SYSTEM", { status: "WhatsApp CONNECTING", origin, connectionAttemptId, reconnectAttempt }),
      "WhatsApp CONNECTING"
    );

    try {
      const { state, saveCreds } = await useMultiFileAuthState(deps.env.WA_SESSION_PATH);
      const initialCreds = (state as any)?.creds?.me;
      deps.setBotSelfLidKey(deps.normalizeJid(initialCreds?.id));
      await deps.loadBotSelfLid();
      await deps.learnBotSelfLid(initialCreds?.lid, "creds.me.lid");
      const { version } = await fetchLatestBaileysVersion();

      const socket = makeWASocket({ auth: state, version, printQRInTerminal: false, logger: deps.baileysLogger });
      const previousSocket = currentSocket;
      currentSocket = socket;
      deps.setSocket(socket);
      if (previousSocket && previousSocket !== socket) cleanupSocket(previousSocket);
      deps.wireInboundEvents(socket);

      socket.ev.on("creds.update", saveCreds);

      socket.ev.on(
        "connection.update",
        async (update: {
          connection?: "close" | "open";
          lastDisconnect?: { error?: unknown };
          qr?: string;
          isNewLogin?: boolean;
          pairingCode?: string;
        }) => {
          if (connectionAttemptId !== connectionGeneration) return;
          try {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
              deps.logger.info(deps.withCategory("SYSTEM", { status: "WhatsApp QR READY", qr }), "WhatsApp QR READY");
              qrcodeTerminal.generate(qr, { small: true });
            }

            const now = Date.now();
            const pairingPhone = deps.env.WA_PAIRING_PHONE;
            const canRequestPairingCode =
              update.isNewLogin === false &&
              update.pairingCode === undefined &&
              pairingPhone &&
              now - lastPairingCodeRequestAt >= PAIRING_CODE_COOLDOWN_MS;
            if (canRequestPairingCode) {
              lastPairingCodeRequestAt = now;
              try {
                const code = await socket.requestPairingCode(pairingPhone);
                deps.logger.info(deps.withCategory("SYSTEM", { status: "WhatsApp PAIRING", code }), "pairing code");
              } catch (error) {
                deps.logger.warn(
                  deps.withCategory("WARN", { status: "WhatsApp PAIRING_CODE_FAILED", err: error }),
                  "WhatsApp PAIRING_CODE_FAILED"
                );
              }
            }

            if (connection === "close") {
              const statusCode = readDisconnectStatusCode(lastDisconnect?.error);
              const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
              deps.setSocket(null);
              await deps.markGatewayHeartbeat(false);
              deps.logger.warn(
                deps.withCategory("WARN", {
                  status: "WhatsApp DISCONNECTED",
                  shouldReconnect,
                  statusCode,
                  connectionAttemptId,
                  reconnectAttempt
                }),
                "WhatsApp DISCONNECTED"
              );
              if (shouldReconnect) scheduleReconnect({ reason: "connection_close", statusCode });
              return;
            }

            if (connection === "open") {
              reconnectAttempt = 0;
              clearReconnectTimer();
              const botId = socket.user?.id ? deps.normalizeJid(socket.user.id) : undefined;
              deps.setBotSelfLidKey(botId);
              await deps.loadBotSelfLid();
              const liveCreds = (socket as any)?.authState?.creds?.me;
              const botLid = await deps.learnBotSelfLid(liveCreds?.lid, "connection.open.me.lid");
              deps.logger.info(
                deps.withCategory("SYSTEM", { status: "WhatsApp CONNECTED", user: socket?.user?.id, botLid, connectionAttemptId }),
                "WhatsApp CONNECTED"
              );
              await deps.markGatewayHeartbeat(true);
            }
          } catch (error) {
            deps.logger.warn(
              deps.withCategory("WARN", { status: "WhatsApp CONNECTION_UPDATE_FAILED", err: error, connectionAttemptId }),
              "WhatsApp CONNECTION_UPDATE_FAILED"
            );
          }
        }
      );
    } catch (error) {
      await deps.markGatewayHeartbeat(false);
      deps.logger.warn(
        deps.withCategory("WARN", { status: "WhatsApp CONNECT_FAILED", err: error, connectionAttemptId, reconnectAttempt }),
        "WhatsApp CONNECT_FAILED"
      );
      scheduleReconnect({ reason: "connect_failed" });
    } finally {
      connectInFlight = false;
    }
  };

  return { connect };
};
