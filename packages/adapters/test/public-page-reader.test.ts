import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { createPublicPageReader, extractPublicPageParagraphs, isPublicAddress } from "../src/search/public-page-reader.js";

const article = `<html><body><nav>Terceiros</nav><article><h1>Backup de máquinas virtuais</h1>
<p>O utilitário vzdump cria backups consistentes de máquinas virtuais e contêineres. O administrador escolhe o armazenamento e configura a política de retenção no Proxmox VE.</p>
<p>Um backup completo contém a configuração da máquina virtual e seus dados. A restauração deve ser verificada em um ambiente de teste separado.</p></article></body></html>`;
const response = (statusCode: number, headers: Record<string, string>, body = "") =>
  Object.assign(Readable.from([body]), { statusCode, headers }) as unknown as IncomingMessage;

test("Readability extracts article paragraphs as text without executing scripts", () => {
  const paragraphs = extractPublicPageParagraphs(article.replace("</body>", "<script>throw Error('should not run')</script></body>"));
  assert.match(paragraphs.join(" "), /vzdump/);
  assert.doesNotMatch(paragraphs.join(" "), /should not run|Terceiros/);
  assert.deepEqual(extractPublicPageParagraphs("<html><body></body></html>"), []);
});

test("blocks local, reserved, disallowed URLs and mixed DNS answers before connecting", async () => {
  assert.ok(isPublicAddress("1.1.1.1"));
  assert.ok(!isPublicAddress("::ffff:127.0.0.1"));
  assert.ok(!isPublicAddress("100.64.0.1"));
  const reader = createPublicPageReader({
    lookup: async () => [{ address: "1.1.1.1", family: 4 }, { address: "192.168.0.2", family: 4 }],
    request: async () => assert.fail("blocked before connect")
  });
  for (const url of ["http://127.0.0.1", "http://169.254.169.254", "https://public.test", "ftp://public.test", "https://public.test:3333", "https://key@public.test"]) {
    await assert.rejects(reader.read({ url, signal: new AbortController().signal }), /page_blocked/);
  }
});

test("pins the DNS answer and validates the redirect target independently", async () => {
  const seen: string[] = [];
  const reader = createPublicPageReader({
    lookup: async () => [{ address: "1.1.1.1", family: 4 }],
    request: async (url, target) => {
      seen.push(url.hostname);
      assert.equal(target.address, "1.1.1.1");
      return response(302, { location: "http://127.0.0.1/internal" });
    }
  });
  await assert.rejects(reader.read({ url: "https://public.test", signal: new AbortController().signal }), /page_blocked/);
  assert.deepEqual(seen, ["public.test"]);
});

test("respects cancellation and rejects non-HTML responses", async () => {
  let called = false;
  const reader = createPublicPageReader({
    lookup: async () => [{ address: "1.1.1.1", family: 4 }],
    request: async () => { called = true; return response(200, { "content-type": "application/pdf" }); }
  });
  await assert.rejects(reader.read({ url: "https://public.test", signal: AbortSignal.abort() }), { name: "AbortError" });
  assert.equal(called, false);
  await assert.rejects(reader.read({ url: "https://public.test", signal: new AbortController().signal }), /page_unavailable/);
});
