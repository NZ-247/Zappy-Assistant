import { strict as assert } from "node:assert";
import test from "node:test";
import { handleDownloadCommand } from "../src/modules/downloads/presentation/commands/download-commands.js";

test("/dl instagram url uses auto-provider wiring and emits media action", async () => {
  const captured: Array<{ provider?: string; url: string }> = [];

  const actions = await handleDownloadCommand({
    commandKey: "dl",
    cmd: "dl https://www.instagram.com/reel/abc123/",
    ctx: {
      event: {
        tenantId: "tenant_test",
        waUserId: "556699999999@s.whatsapp.net"
      }
    } as any,
    deps: {
      config: { enabled: true },
      mediaDownload: {
        resolve: async (input) => {
          captured.push({ provider: input.provider, url: input.url });
          return {
            provider: "ig",
            status: "ready",
            title: undefined,
            url: "https://cdn.example.com/ig/reel.mp4",
            asset: {
              kind: "video",
              mimeType: "video/mp4",
              directUrl: "https://cdn.example.com/ig/reel.mp4"
            }
          };
        }
      }
    }
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.provider, undefined);
  assert.equal(captured[0]?.url, "https://www.instagram.com/reel/abc123/");
  assert.equal(actions?.[0]?.kind, "reply_video");
  assert.equal((actions?.[0] as any)?.caption, "via /dl ig");
});

test("/dl blocked/private failures return one clear sentence", async () => {
  const actions = await handleDownloadCommand({
    commandKey: "dl",
    cmd: "dl ig https://www.instagram.com/p/private/",
    ctx: {
      event: {
        tenantId: "tenant_test",
        waUserId: "556699999999@s.whatsapp.net"
      }
    } as any,
    deps: {
      config: { enabled: true },
      mediaDownload: {
        resolve: async () => ({
          provider: "ig",
          status: "blocked",
          reason: "private_or_login_required"
        })
      }
    }
  });

  assert.equal(actions?.[0]?.kind, "reply_text");
  assert.match((actions?.[0] as any).text, /privado|login/i);
});

test("/dl instagram preview-only result returns short text instead of fake media success", async () => {
  const actions = await handleDownloadCommand({
    commandKey: "dl",
    cmd: "dl ig https://www.instagram.com/reel/previewonly/",
    ctx: {
      event: {
        tenantId: "tenant_test",
        waUserId: "556699999999@s.whatsapp.net"
      }
    } as any,
    deps: {
      config: { enabled: true },
      mediaDownload: {
        resolve: async () => ({
          provider: "ig",
          status: "unsupported",
          reason: "preview_only"
        })
      }
    }
  });

  assert.equal(actions?.[0]?.kind, "reply_text");
  assert.match((actions?.[0] as any).text, /prévia|preview|video/i);
});

test("/dl login-required result returns concise login message", async () => {
  const actions = await handleDownloadCommand({
    commandKey: "dl",
    cmd: "dl fb https://www.facebook.com/watch/?v=1234567890",
    ctx: {
      event: {
        tenantId: "tenant_test",
        waUserId: "556699999999@s.whatsapp.net"
      }
    } as any,
    deps: {
      config: { enabled: true },
      mediaDownload: {
        resolve: async () => ({
          provider: "fb",
          status: "blocked",
          resultKind: "login_required",
          reason: "login_required"
        })
      }
    }
  });

  assert.equal(actions?.[0]?.kind, "reply_text");
  assert.match((actions?.[0] as any).text, /login|acesso/i);
});
