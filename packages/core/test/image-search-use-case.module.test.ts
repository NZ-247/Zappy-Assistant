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
            source: "wikimedia",
            title: "Gato 1",
            link: "https://example.com/gato-1",
            pageUrl: "https://example.com/gato-1",
            imageUrl: "https://cdn.example.com/gato-1.jpg"
          }
        ],
        candidateDiagnostics: [
          {
            source: "wikimedia",
            title: "Gato 1",
            link: "https://example.com/gato-1",
            pageUrl: "https://example.com/gato-1",
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
            source: "google_cse",
            title: "Porsche 911 GT3RS",
            link: "https://example.com/porsche",
            pageUrl: "https://example.com/porsche",
            imageUrl: "https://cdn.example.com/porsche.jpg"
          }
        ],
        deliverableImage: {
          source: "google_cse",
          title: "Porsche 911 GT3RS",
          link: "https://example.com/porsche",
          pageUrl: "https://example.com/porsche",
          imageUrl: "https://cdn.example.com/porsche.jpg",
          imageBase64,
          mimeType: "image/jpeg",
          byteLength: 604,
          candidateIndex: 1
        },
        candidateDiagnostics: [
          {
            source: "google_cse",
            title: "Porsche 911 GT3RS",
            link: "https://example.com/porsche",
            pageUrl: "https://example.com/porsche",
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
    caption?: string;
    fallbackText?: string;
  };
  assert.equal(imageAction.imageBase64, imageBase64);
  assert.equal(imageAction.mimeType, "image/jpeg");
  assert.match(imageAction.caption ?? "", /Fonte:/i);
  assert.match(imageAction.caption ?? "", /https:\/\/example.com\/porsche/i);
  assert.doesNotMatch(imageAction.caption ?? "", /Mais resultados:/i);
  assert.match(imageAction.fallbackText ?? "", /imagem/i);
});

test("imglink mode returns concise single-link fallback when no deliverable media is available", async () => {
  const actions = await executeImageSearch({
    query: "ferrari",
    mode: "media_or_links",
    config: { enabled: true, maxResults: 3 },
    imageSearch: {
      search: async () => ({
        provider: "wikimedia",
        results: [
          {
            source: "wikimedia",
            title: "Ferrari F40",
            link: "https://commons.wikimedia.org/wiki/File:Ferrari_F40.jpg",
            pageUrl: "https://commons.wikimedia.org/wiki/File:Ferrari_F40.jpg",
            imageUrl: "https://upload.wikimedia.org/ferrari-f40.jpg",
            attribution: "John Doe",
            licenseInfo: {
              name: "CC BY-SA 4.0",
              url: "https://creativecommons.org/licenses/by-sa/4.0/"
            }
          },
          {
            source: "openverse",
            title: "Ferrari 488",
            link: "https://example.com/ferrari-488",
            pageUrl: "https://example.com/ferrari-488",
            imageUrl: "https://cdn.example.com/ferrari-488.jpg"
          },
          {
            source: "pixabay",
            title: "Ferrari Race",
            link: "https://pixabay.com/photos/ferrari-race",
            pageUrl: "https://pixabay.com/photos/ferrari-race",
            imageUrl: "https://cdn.example.com/ferrari-race.jpg"
          }
        ],
        candidateDiagnostics: [
          {
            source: "wikimedia",
            title: "Ferrari F40",
            link: "https://commons.wikimedia.org/wiki/File:Ferrari_F40.jpg",
            pageUrl: "https://commons.wikimedia.org/wiki/File:Ferrari_F40.jpg",
            imageUrl: "https://upload.wikimedia.org/ferrari-f40.jpg",
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
  const reply = (actions[0] as { text: string }).text;
  assert.match(reply, /Fonte:/i);
  assert.match(reply, /https:\/\/commons.wikimedia.org\/wiki\/File:Ferrari_F40.jpg/i);
  assert.doesNotMatch(reply, /1\./);
  assert.doesNotMatch(reply, /2\./);
});

test("img caption formatting rejects filename-like titles", async () => {
  const imageBase64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(640, 9)]).toString("base64");

  const actions = await executeImageSearch({
    query: "meme arabe",
    config: { enabled: true, maxResults: 3 },
    imageSearch: {
      search: async () => ({
        provider: "google_cse",
        results: [
          {
            source: "google_cse",
            title: "IMG_20250202_194455.JPG",
            link: "https://example.com/meme-arabe",
            pageUrl: "https://example.com/meme-arabe",
            imageUrl: "https://cdn.example.com/meme-arabe.jpg"
          }
        ],
        deliverableImage: {
          source: "google_cse",
          title: "IMG_20250202_194455.JPG",
          link: "https://example.com/meme-arabe",
          pageUrl: "https://example.com/meme-arabe",
          imageUrl: "https://cdn.example.com/meme-arabe.jpg",
          imageBase64,
          mimeType: "image/jpeg",
          byteLength: 644,
          candidateIndex: 1
        }
      })
    }
  });

  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.kind, "reply_image");
  const caption = (actions[0] as { caption?: string }).caption ?? "";
  assert.match(caption, /Fonte:/i);
  assert.match(caption, /https:\/\/example\.com\/meme-arabe/i);
  assert.doesNotMatch(caption, /IMG_20250202_194455/i);
});
