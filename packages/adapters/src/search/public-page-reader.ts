import { lookup as dnsLookup } from "node:dns/promises";
import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import type { PublicPageReaderPort } from "@zappy/core";

const maxBytes = 512 * 1024;
const redirects = new Set([301, 302, 303, 307, 308]);

export function publicWebUrl(value: string): URL {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error("page_blocked");
  }
  url.hash = "";
  return url;
}

export function isPublicAddress(value: string): boolean {
  try {
    const address = ipaddr.process(value);
    if (address.range() !== "unicast") return false;
    return address.kind() === "ipv4" || address.match(ipaddr.IPv6.parse("2000::"), 3);
  } catch {
    return false;
  }
}

type Address = { address: string; family: number };
type Dependencies = {
  lookup?: (host: string) => Promise<Address[]>;
  request?: (url: URL, address: Address, signal: AbortSignal) => Promise<IncomingMessage>;
};

async function resolvePublic(url: URL, lookup: NonNullable<Dependencies["lookup"]>): Promise<Address> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  const answers = family ? [{ address: host, family }] : await lookup(host);
  if (!answers.length || answers.some(({ address }) => !isPublicAddress(address))) throw new Error("page_blocked");
  return answers.find((answer) => answer.family === 4) ?? answers[0];
}

function requestPinned(url: URL, target: Address, signal: AbortSignal): Promise<IncomingMessage> {
  const get = url.protocol === "https:" ? httpsGet : httpGet;
  return new Promise((resolve, reject) => {
    const req = get(url, {
      signal, agent: false, family: target.family,
      lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "ZappyAssistant/1.9 (+public web search)" }
    }, resolve);
    req.once("error", reject);
  });
}

function extractPublicPage(html: string, section?: "system-cron" | "qmrestore"): { paragraphs: string[]; language?: string } {
  const dom = new JSDOM(html);
  try {
    if (section === "qmrestore") {
      const nodes = dom.window.document.querySelectorAll("h2#_name + .sectionbody p, h2#_synopsis + .sectionbody p, h2#_description + .sectionbody p");
      return { paragraphs: [...nodes].slice(0,240).map(node => (node.textContent ?? "").replace(/\s+/g," ").trim().slice(0,700)), language: "en" };
    }
    if (section === "system-cron") {
      const element = dom.window.document.querySelector("section#cron, div.section#cron");
      if (!element || !/^Cron\s*[^\p{L}]*$/iu.test(element.querySelector("h2,h3,h4")?.textContent ?? "")) return { paragraphs: [] };
      const paragraphs = [...element.querySelectorAll("p,pre")].slice(0, 240)
        .map(node => (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 700));
      return { paragraphs, language: dom.window.document.documentElement.lang };
    }
    const article = new Readability(dom.window.document, { maxElemsToParse: 18_000, charThreshold: 100 }).parse();
    const language = dom.window.document.documentElement.lang.trim().toLowerCase() || undefined;
    if (!article?.content) return { paragraphs: [], language };
    const template = dom.window.document.createElement("template");
    template.innerHTML = article.content;
    const paragraphs = [...template.content.querySelectorAll("p, pre, li, blockquote")]
      .slice(0, 240)
      .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter((text) => text.length >= 25)
      .map((text) => text.slice(0, 700));
    return { paragraphs, language };
  } finally {
    dom.window.close();
  }
}

export function extractPublicPageParagraphs(html: string): string[] {
  return extractPublicPage(html).paragraphs;
}

async function readHtml(response: IncomingMessage): Promise<string> {
  const mime = response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (response.statusCode !== 200 || !["text/html", "application/xhtml+xml"].includes(mime ?? "") ||
      Number(response.headers["content-length"]) > maxBytes) {
    response.destroy();
    throw new Error("page_unavailable");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) {
      response.destroy();
      throw new Error("page_too_large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createPublicPageReader(deps: Dependencies = {}): PublicPageReaderPort {
  const lookup = deps.lookup ?? ((host) => dnsLookup(host, { all: true, verbatim: true }));
  const request = deps.request ?? requestPinned;
  return {
    async read({ url: input, signal: parent, section }) {
      const deadline = performance.now() + 1800;
      const signal = AbortSignal.any([parent, AbortSignal.timeout(1800)]);
      let url = publicWebUrl(input);
      for (let hop = 0; hop <= 2; hop++) {
        signal.throwIfAborted();
        const target = await resolvePublic(url, lookup);
        signal.throwIfAborted();
        const response = await request(url, target, signal);
        const status = response.statusCode ?? 0;
        if (redirects.has(status)) {
          const location = response.headers.location;
          response.destroy();
          if (!location || hop === 2) throw new Error("page_redirect_limit");
          url = publicWebUrl(new URL(location, url).href);
          continue;
        }
        let html: string;
        try { html = await readHtml(response); } catch (error) {
          if (signal.aborted) throw new Error("page_timeout");
          throw error;
        }
        signal.throwIfAborted();
        const page = extractPublicPage(html, section);
        if (performance.now() >= deadline) throw new Error("page_timeout");
        return { url: url.href, ...page };
      }
      throw new Error("page_redirect_limit");
    }
  };
}
