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
    sendMessage(to: string, message: { text: string }): Promise<{ key: { id?: string } }>;
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
              extendedTextMessage?: { text?: string };
              imageMessage?: { caption?: string };
            };
            messageTimestamp?: number | { toString: () => string };
          }>;
        }) => Promise<void>
      ): void;
    };
  }

  export default function makeWASocket(config: { auth: unknown; version: [number, number, number]; printQRInTerminal: boolean }): BaileysSocket;
}
