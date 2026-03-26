import { strict as assert } from "node:assert";
import test from "node:test";
import { createImageSearchAdapter } from "../src/search/image-search-adapter.js";

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });

const validJpegBuffer = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(700, 1)]);

test("image candidate validation skips first failed candidate and selects next", async () => {
  const fetchCalls: string[] = [];
  const fetchImpl = async (input: string | URL): Promise<Response> => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.startsWith("https://commons.wikimedia.org/w/api.php")) {
      return jsonResponse({
        query: {
          pages: {
            "1": {
              title: "Imagem bloqueada",
              imageinfo: [{ url: "https://cdn.example.com/blocked.jpg", descriptionurl: "https://example.com/blocked" }]
            },
            "2": {
              title: "Imagem valida",
              imageinfo: [{ url: "https://cdn.example.com/ok.jpg", descriptionurl: "https://example.com/ok" }]
            }
          }
        }
      });
    }

    if (url === "https://cdn.example.com/blocked.jpg") {
      return new Response("forbidden", { status: 403 });
    }

    if (url === "https://cdn.example.com/ok.jpg") {
      return new Response(validJpegBuffer, {
        status: 200,
        headers: { "content-type": "image/jpeg" }
      });
    }

    throw new Error(`unexpected_url:${url}`);
  };

  const adapter = createImageSearchAdapter({
    preferredProvider: "wikimedia",
    fetchImpl
  });

  const result = await adapter.search({
    query: "gatos",
    limit: 3
  });

  assert.equal(result.provider, "wikimedia");
  assert.equal(result.deliverableImage?.imageUrl, "https://cdn.example.com/ok.jpg");
  assert.equal(result.deliverableImage?.candidateIndex, 2);
  assert.equal(result.candidateDiagnostics?.[0]?.status, "rejected");
  assert.equal(result.candidateDiagnostics?.[0]?.reason, "http_403");
  assert.equal(result.candidateDiagnostics?.[1]?.status, "accepted");
  assert.ok(fetchCalls.includes("https://cdn.example.com/blocked.jpg"));
  assert.ok(fetchCalls.includes("https://cdn.example.com/ok.jpg"));
});

test("image candidate validation returns no deliverable when all candidates are invalid", async () => {
  const fetchImpl = async (input: string | URL): Promise<Response> => {
    const url = String(input);
    if (url.startsWith("https://commons.wikimedia.org/w/api.php")) {
      return jsonResponse({
        query: {
          pages: {
            "1": {
              title: "Nao imagem",
              imageinfo: [{ url: "https://cdn.example.com/not-image.jpg", descriptionurl: "https://example.com/not-image" }]
            }
          }
        }
      });
    }

    if (url === "https://cdn.example.com/not-image.jpg") {
      return new Response("<html>blocked</html>", {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }

    throw new Error(`unexpected_url:${url}`);
  };

  const adapter = createImageSearchAdapter({
    preferredProvider: "wikimedia",
    fetchImpl
  });

  const result = await adapter.search({
    query: "gatos",
    limit: 3
  });

  assert.equal(result.provider, "wikimedia");
  assert.equal(result.deliverableImage, undefined);
  assert.equal(result.candidateDiagnostics?.[0]?.status, "rejected");
  assert.equal(result.candidateDiagnostics?.[0]?.reason, "invalid_content_type");
});
