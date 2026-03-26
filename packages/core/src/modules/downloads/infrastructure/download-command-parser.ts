import { resolveDownloadProvider, type DownloadProviderKey } from "../domain/download-provider.js";

export type DownloadCommandParseFailure =
  | "missing_input"
  | "missing_provider_or_url"
  | "invalid_provider_or_url"
  | "missing_url"
  | "invalid_url";

export type DownloadCommandParseResult =
  | { ok: true; provider?: DownloadProviderKey; url: string }
  | { ok: false; reason: DownloadCommandParseFailure };

const isValidHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const parseDownloadCommand = (commandBody: string): DownloadCommandParseResult => {
  const args = commandBody.replace(/^dl\b/i, "").trim();
  if (!args) return { ok: false, reason: "missing_input" };

  const [providerRaw, ...rest] = args.split(/\s+/).filter(Boolean);
  if (!providerRaw) return { ok: false, reason: "missing_provider_or_url" };

  if (isValidHttpUrl(providerRaw)) {
    return { ok: true, provider: undefined, url: providerRaw };
  }

  const provider = resolveDownloadProvider(providerRaw);
  if (!provider) return { ok: false, reason: "invalid_provider_or_url" };

  const url = rest.join(" ").trim();
  if (!url) return { ok: false, reason: "missing_url" };
  if (!isValidHttpUrl(url)) return { ok: false, reason: "invalid_url" };

  return { ok: true, provider, url };
};
