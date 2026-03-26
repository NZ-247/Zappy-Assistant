import { strict as assert } from "node:assert";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import { createImageSearchAdapter } from "../src/search/image-search-adapter.js";

const validJpegBuffer = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(700, 2)]);

const startServer = async (
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ baseUrl: string; close: () => Promise<void> }> => {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("address_unavailable");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
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

const createRewritingFetch = (baseUrl: string) => {
  return (input: string | URL, init?: RequestInit) => {
    const raw = String(input);
    if (raw.startsWith("https://commons.wikimedia.org/w/api.php")) {
      return fetch(`${baseUrl}/wikimedia`, init);
    }
    return fetch(raw.replace("https://test.local", baseUrl), init);
  };
};

test("integration: adapter keeps flow stable when remote image returns 403", async () => {
  const server = await startServer((req, res) => {
    if (req.url?.startsWith("/wikimedia")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          query: {
            pages: {
              "1": {
                title: "Bloqueada",
                imageinfo: [{ url: "https://test.local/forbidden.jpg", descriptionurl: "https://example.com/forbidden" }]
              }
            }
          }
        })
      );
      return;
    }
    if (req.url === "/forbidden.jpg") {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden");
      return;
    }
    res.writeHead(404).end();
  });

  try {
    const adapter = createImageSearchAdapter({
      preferredProvider: "wikimedia",
      fetchImpl: createRewritingFetch(server.baseUrl)
    });

    const result = await adapter.search({ query: "porsche", limit: 3 });
    assert.equal(result.deliverableImage, undefined);
    assert.equal(result.candidateDiagnostics?.[0]?.reason, "http_403");
  } finally {
    await server.close();
  }
});

test("integration: adapter follows redirects and returns deliverable media", async () => {
  const hits: string[] = [];
  const server = await startServer((req, res) => {
    hits.push(req.url ?? "");
    if (req.url?.startsWith("/wikimedia")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          query: {
            pages: {
              "1": {
                title: "Redirecionada",
                imageinfo: [{ url: "https://test.local/redirect-image", descriptionurl: "https://example.com/redirect" }]
              }
            }
          }
        })
      );
      return;
    }
    if (req.url === "/redirect-image") {
      res.writeHead(302, { location: "/real-image.jpg" });
      res.end();
      return;
    }
    if (req.url === "/real-image.jpg") {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(validJpegBuffer);
      return;
    }
    res.writeHead(404).end();
  });

  try {
    const adapter = createImageSearchAdapter({
      preferredProvider: "wikimedia",
      fetchImpl: createRewritingFetch(server.baseUrl)
    });

    const result = await adapter.search({ query: "porsche", limit: 3 });
    assert.equal(result.deliverableImage?.mimeType, "image/jpeg");
    assert.equal(result.candidateDiagnostics?.[0]?.status, "accepted");
    assert.ok(hits.includes("/redirect-image"));
    assert.ok(hits.includes("/real-image.jpg"));
  } finally {
    await server.close();
  }
});

test("integration: adapter rejects invalid content-type payloads", async () => {
  const server = await startServer((req, res) => {
    if (req.url?.startsWith("/wikimedia")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          query: {
            pages: {
              "1": {
                title: "HTML",
                imageinfo: [{ url: "https://test.local/html-response", descriptionurl: "https://example.com/html" }]
              }
            }
          }
        })
      );
      return;
    }
    if (req.url === "/html-response") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>not an image</html>");
      return;
    }
    res.writeHead(404).end();
  });

  try {
    const adapter = createImageSearchAdapter({
      preferredProvider: "wikimedia",
      fetchImpl: createRewritingFetch(server.baseUrl)
    });

    const result = await adapter.search({ query: "porsche", limit: 3 });
    assert.equal(result.deliverableImage, undefined);
    assert.equal(result.candidateDiagnostics?.[0]?.reason, "invalid_content_type");
  } finally {
    await server.close();
  }
});
