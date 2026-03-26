import { strict as assert } from "node:assert";
import test from "node:test";
import { executeImageSearch } from "../src/modules/image-search/application/use-cases/search-images.js";

test("img command returns reply_text when no validated media candidate survives", async () => {
  const actions = await executeImageSearch({
    query: "gatos",
    config: { enabled: true, maxResults: 3 },
    imageSearch: {
      search: async () => ({
        provider: "wikimedia",
        results: [
          {
            title: "Gato 1",
            link: "https://example.com/gato-1",
            imageUrl: "https://cdn.example.com/gato-1.jpg"
          }
        ],
        candidateDiagnostics: [
          {
            title: "Gato 1",
            link: "https://example.com/gato-1",
            imageUrl: "https://cdn.example.com/gato-1.jpg",
            candidateIndex: 1,
            status: "rejected",
            reason: "http_403"
          }
        ]
      })
    }
  });

  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.kind, "reply_text");
  assert.match((actions[0] as { text: string }).text, /baixar uma imagem/i);
});

test("img command returns reply_image only when validated media exists", async () => {
  const imageBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xdb, ...new Array(600).fill(1)]).toString("base64");
  const actions = await executeImageSearch({
    query: "porsche 911 gt3rs",
    config: { enabled: true, maxResults: 3 },
    imageSearch: {
      search: async () => ({
        provider: "google_cse",
        results: [
          {
            title: "Porsche 911 GT3RS",
            link: "https://example.com/porsche",
            imageUrl: "https://cdn.example.com/porsche.jpg"
          }
        ],
        deliverableImage: {
          title: "Porsche 911 GT3RS",
          link: "https://example.com/porsche",
          imageUrl: "https://cdn.example.com/porsche.jpg",
          imageBase64,
          mimeType: "image/jpeg",
          byteLength: 604,
          candidateIndex: 1
        },
        candidateDiagnostics: [
          {
            title: "Porsche 911 GT3RS",
            link: "https://example.com/porsche",
            imageUrl: "https://cdn.example.com/porsche.jpg",
            candidateIndex: 1,
            status: "accepted",
            reason: "ok",
            mimeType: "image/jpeg",
            byteLength: 604
          }
        ]
      })
    }
  });

  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.kind, "reply_image");
  const imageAction = actions[0] as {
    imageBase64?: string;
    mimeType?: string;
    fallbackText?: string;
  };
  assert.equal(imageAction.imageBase64, imageBase64);
  assert.equal(imageAction.mimeType, "image/jpeg");
  assert.match(imageAction.fallbackText ?? "", /imagem/i);
});
