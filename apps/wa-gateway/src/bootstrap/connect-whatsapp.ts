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

export const createWhatsAppConnector = (deps: ConnectWhatsAppDeps) => {
  const connect = async () => {
    deps.logger.info(deps.withCategory("SYSTEM", { status: "WhatsApp CONNECTING" }), "WhatsApp CONNECTING");
    const { state, saveCreds } = await useMultiFileAuthState(deps.env.WA_SESSION_PATH);
    const initialCreds = (state as any)?.creds?.me;
    deps.setBotSelfLidKey(deps.normalizeJid(initialCreds?.id));
    await deps.loadBotSelfLid();
    await deps.learnBotSelfLid(initialCreds?.lid, "creds.me.lid");
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({ auth: state, version, printQRInTerminal: false, logger: deps.baileysLogger });
    deps.setSocket(socket);
    deps.wireInboundEvents(socket);

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on(
      "connection.update",
      async (update: { connection?: "close" | "open"; lastDisconnect?: { error?: unknown }; qr?: string; isNewLogin?: boolean; pairingCode?: string }) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
          deps.logger.info(deps.withCategory("SYSTEM", { status: "WhatsApp QR READY", qr }), "WhatsApp QR READY");
          qrcodeTerminal.generate(qr, { small: true });
        }
        if (update.isNewLogin === false && update.pairingCode === undefined && deps.env.WA_PAIRING_PHONE) {
          const code = await socket?.requestPairingCode(deps.env.WA_PAIRING_PHONE);
          deps.logger.info(deps.withCategory("SYSTEM", { status: "WhatsApp PAIRING", code }), "pairing code");
        }
        if (connection === "close") {
          const shouldReconnect = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode !== DisconnectReason.loggedOut;
          deps.logger.warn(deps.withCategory("WARN", { status: "WhatsApp DISCONNECTED", shouldReconnect }), "WhatsApp DISCONNECTED");
          if (shouldReconnect) void connect();
        } else if (connection === "open") {
          const botId = socket?.user?.id ? deps.normalizeJid(socket.user.id) : undefined;
          deps.setBotSelfLidKey(botId);
          await deps.loadBotSelfLid();
          const liveCreds = (socket as any)?.authState?.creds?.me;
          const botLid = await deps.learnBotSelfLid(liveCreds?.lid, "connection.open.me.lid");
          deps.logger.info(
            deps.withCategory("SYSTEM", { status: "WhatsApp CONNECTED", user: socket?.user?.id, botLid }),
            "WhatsApp CONNECTED"
          );
          await deps.markGatewayHeartbeat(true);
        }
      }
    );
  };

  return { connect };
};
