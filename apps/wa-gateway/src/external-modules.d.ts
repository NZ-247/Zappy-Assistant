import type { Logger } from "pino";

declare module "@hapi/boom" {
  export class Boom {
    output?: { statusCode?: number };
  }
}

declare module "baileys" {
  export const DisconnectReason: { loggedOut: number };
  export function fetchLatestBaileysVersion(): Promise<{ version: [number, number, number] }>;
  export function useMultiFileAuthState(path: string): Promise<{ state: unknown; saveCreds: () => Promise<void> }>;

  export interface BaileysSocket {
    user?: { id?: string };
    requestPairingCode(phone: string): Promise<string>;
    sendMessage(
      to: string,
      message: { text: string },
      options?: { quoted?: unknown }
    ): Promise<{ key: { id?: string } }>;
    groupMetadata(
      jid: string
    ): Promise<{ id: string; subject?: string; participants?: Array<{ id: string; admin?: string | boolean; isAdmin?: boolean }> }>;
    ev: {
      on(event: "creds.update", handler: () => Promise<void>): void;
      on(
        event: "connection.update",
        handler: (update: {
          connection?: "close" | "open";
          lastDisconnect?: { error?: unknown };
          qr?: string;
          isNewLogin?: boolean;
          pairingCode?: string;
        }) => Promise<void>
      ): void;
      on(
        event: "messages.upsert",
        handler: (payload: {
          type: string;
          messages: Array<{
            key: { fromMe?: boolean; remoteJid?: string; participant?: string; id?: string };
            message?: {
              conversation?: string;
              extendedTextMessage?: { text?: string; contextInfo?: unknown };
              imageMessage?: { caption?: string; contextInfo?: unknown };
              videoMessage?: { caption?: string; contextInfo?: unknown };
              documentMessage?: { caption?: string; contextInfo?: unknown };
              audioMessage?: { contextInfo?: unknown };
              stickerMessage?: { contextInfo?: unknown };
            };
            messageTimestamp?: number | { toString: () => string };
          }>;
        }) => Promise<void>
      ): void;
    };
  }

  export interface BaileysConfig {
    auth: unknown;
    version: [number, number, number];
    printQRInTerminal: boolean;
    logger?: Logger;
  }

  export default function makeWASocket(config: BaileysConfig): BaileysSocket;
}
