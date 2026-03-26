import { strict as assert } from "node:assert";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import { createInstagramDownloadProvider } from "../src/downloads/providers/instagram-provider.js";

const reelBuffer = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(2048, 7)]);
const imageBuffer = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(1024, 3)]);

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
    if (raw.startsWith("https://www.instagram.com")) {
      return fetch(raw.replace("https://www.instagram.com", baseUrl), init);
    }
    if (raw.startsWith("https://instagram.com")) {
      return fetch(raw.replace("https://instagram.com", baseUrl), init);
    }
    if (raw.startsWith("https://cdn.instagram.local")) {
      return fetch(raw.replace("https://cdn.instagram.local", baseUrl), init);
    }
    return fetch(raw, init);
  };
};

test("unit: instagram detect distinguishes reel, post and unsupported paths", () => {
  const provider = createInstagramDownloadProvider();

  const reel = provider.detect({
    url: "https://www.instagram.com/reel/abc123/"
  });
  assert.equal(reel?.provider, "ig");
  assert.equal(reel?.reason, "instagram_reel");

  const post = provider.detect({
    url: "https://www.instagram.com/p/abc123/"
  });
  assert.equal(post?.provider, "ig");
  assert.equal(post?.reason, "instagram_post");

  const unsupported = provider.detect({
    url: "https://www.instagram.com/explore/tags/test/"
  });
  assert.equal(unsupported?.provider, "ig");
  assert.equal(unsupported?.reason, "instagram_unknown_path");
});

test("integration: instagram provider detects and probes public reel", async () => {
  const server = await startServer((req, res) => {
    if (req.url === "/reel/abc123/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
      <html><head>
      <meta property="og:url" content="https://www.instagram.com/reel/abc123/" />
      <meta property="og:title" content="Reel publico teste" />
      <meta property="og:video" content="https://cdn.instagram.local/media/reel.mp4" />
      <meta property="og:image" content="https://cdn.instagram.local/media/thumb.jpg" />
      </head><body>ok</body></html>`);
      return;
    }
    if (req.url === "/media/reel.mp4") {
      if (req.method === "HEAD") {
        res.writeHead(200, {
          "content-type": "video/mp4",
          "content-length": String(reelBuffer.length)
        });
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": String(reelBuffer.length)
      });
      res.end(reelBuffer);
      return;
    }
    if (req.url === "/media/thumb.jpg") {
      if (req.method === "HEAD") {
        res.writeHead(200, {
          "content-type": "image/jpeg",
          "content-length": String(imageBuffer.length)
        });
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "image/jpeg",
        "content-length": String(imageBuffer.length)
      });
      res.end(imageBuffer);
      return;
    }
    res.writeHead(404).end();
  });

  try {
    const provider = createInstagramDownloadProvider({
      fetchImpl: createRewritingFetch(server.baseUrl)
    });

    const detection = provider.detect({
      url: "https://www.instagram.com/reel/abc123/"
    });
    assert.equal(detection?.provider, "ig");
    assert.equal(detection?.family, "instagram");
    assert.equal(detection?.reason, "instagram_reel");

    const probe = await provider.probe({
      url: "https://www.instagram.com/reel/abc123/"
    });
    assert.equal(probe.status, "ready");
    assert.equal(probe.provider, "ig");
    assert.equal(probe.title, "Reel publico teste");
    assert.equal(probe.reason, "reel_video");
    assert.equal(probe.metadata?.mimeType, "video/mp4");

    const execution = await provider.download({
      url: "https://www.instagram.com/reel/abc123/"
    });
    assert.equal(execution.status, "ready");
    assert.equal(execution.assets.length, 1);
    assert.equal(execution.assets[0]?.kind, "video");
    assert.equal(execution.assets[0]?.mimeType, "video/mp4");
    assert.equal(typeof execution.assets[0]?.bufferBase64, "string");
    assert.ok((execution.assets[0]?.bufferBase64 ?? "").length > 16);
  } finally {
    await server.close();
  }
});

test("integration: instagram reel preview-only is reported as unsupported and does not fake image/video success", async () => {
  const server = await startServer((req, res) => {
    if (req.url === "/reel/preview123/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
      <html><head>
      <meta property="og:url" content="https://www.instagram.com/reel/preview123/" />
      <meta property="og:title" content="Reel com preview apenas" />
      <meta property="og:image" content="https://cdn.instagram.local/media/thumb.jpg" />
      </head><body>ok</body></html>`);
      return;
    }
    if (req.url === "/media/thumb.jpg") {
      if (req.method === "HEAD") {
        res.writeHead(200, {
          "content-type": "image/jpeg",
          "content-length": String(imageBuffer.length)
        });
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "image/jpeg",
        "content-length": String(imageBuffer.length)
      });
      res.end(imageBuffer);
      return;
    }
    res.writeHead(404).end();
  });

  try {
    const provider = createInstagramDownloadProvider({
      fetchImpl: createRewritingFetch(server.baseUrl)
    });

    const probe = await provider.probe({
      url: "https://www.instagram.com/reel/preview123/"
    });
    assert.equal(probe.status, "unsupported");
    assert.equal(probe.reason, "preview_only");

    const execution = await provider.download({
      url: "https://www.instagram.com/reel/preview123/"
    });
    assert.equal(execution.status, "unsupported");
    assert.equal(execution.reason, "preview_only");
    assert.equal(execution.assets.length, 0);
  } finally {
    await server.close();
  }
});

test("integration: instagram provider handles private links gracefully", async () => {
  const server = await startServer((req, res) => {
    if (req.url === "/p/private123/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body>This Account is Private</body></html>");
      return;
    }
    res.writeHead(404).end();
  });

  try {
    const provider = createInstagramDownloadProvider({
      fetchImpl: createRewritingFetch(server.baseUrl)
    });

    const probe = await provider.probe({
      url: "https://www.instagram.com/p/private123/"
    });
    assert.equal(probe.status, "blocked");
    assert.match(probe.reason ?? "", /private|login/i);

    const execution = await provider.download({
      url: "https://www.instagram.com/p/private123/"
    });
    assert.equal(execution.status, "blocked");
    assert.equal(execution.assets.length, 0);
  } finally {
    await server.close();
  }
});

test("integration: instagram provider returns first item policy for carousel post", async () => {
  const server = await startServer((req, res) => {
    if (req.url === "/p/carousel1/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
      <html><head>
      <meta property="og:url" content="https://www.instagram.com/p/carousel1/" />
      <meta property="og:title" content="Post com carrossel" />
      <meta property="og:image" content="https://cdn.instagram.local/media/photo.jpg" />
      </head><body>
      <script>{"edge_sidecar_to_children":{"edges":[{"node":{}},{"node":{}},{"node":{}}]}}</script>
      </body></html>`);
      return;
    }
    if (req.url === "/media/photo.jpg") {
      if (req.method === "HEAD") {
        res.writeHead(200, {
          "content-type": "image/jpeg",
          "content-length": String(imageBuffer.length)
        });
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "image/jpeg",
        "content-length": String(imageBuffer.length)
      });
      res.end(imageBuffer);
      return;
    }
    res.writeHead(404).end();
  });

  try {
    const provider = createInstagramDownloadProvider({
      fetchImpl: createRewritingFetch(server.baseUrl)
    });

    const probe = await provider.probe({
      url: "https://www.instagram.com/p/carousel1/"
    });
    assert.equal(probe.status, "ready");
    assert.equal(probe.reason, "carousel_first_item_only");
    assert.equal(probe.metadata?.mimeType, "image/jpeg");

    const execution = await provider.download({
      url: "https://www.instagram.com/p/carousel1/"
    });
    assert.equal(execution.status, "ready");
    assert.equal(execution.reason, "carousel_first_item_only");
    assert.equal(execution.assets[0]?.kind, "image");
  } finally {
    await server.close();
  }
});
