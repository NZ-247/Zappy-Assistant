export type DownloadProviderKey = "yt" | "ig" | "fb" | "direct";

const aliasMap: Record<string, DownloadProviderKey> = {
  yt: "yt",
  youtube: "yt",
  ig: "ig",
  insta: "ig",
  instagram: "ig",
  fb: "fb",
  facebook: "fb",
  direct: "direct",
  url: "direct"
};

export const resolveDownloadProvider = (value: string): DownloadProviderKey | null => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return aliasMap[normalized] ?? null;
};

export const isSupportedDownloadProvider = (value: string): value is DownloadProviderKey => {
  return ["yt", "ig", "fb", "direct"].includes(value);
};
