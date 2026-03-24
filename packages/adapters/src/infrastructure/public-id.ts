export interface PublicIdCodec {
  prefix: string;
  formatFromSequence: (sequence: number) => string;
  fallbackFromRecordId: (id: string) => string;
  normalize: (value?: string | null) => string | null;
  parseSequence: (publicId: string) => number | null;
}

export const createPublicIdCodec = (prefixInput: string, options?: { strictNumericSequence?: boolean }): PublicIdCodec => {
  const prefix = prefixInput.toUpperCase();

  const formatFromSequence = (sequence: number): string => {
    return `${prefix}${Math.max(1, sequence).toString().padStart(3, "0")}`;
  };

  const fallbackFromRecordId = (id: string): string => {
    return `${prefix}${id.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase()}`;
  };

  const normalize = (value?: string | null): string | null => {
    if (!value) return null;
    const trimmed = value.trim().toUpperCase();
    const withoutPrefix = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
    const normalized = withoutPrefix.replace(/[^A-Z0-9]/g, "");
    if (!normalized) return null;
    return `${prefix}${normalized}`;
  };

  const parseSequence = (publicId: string): number | null => {
    const normalized = normalize(publicId);
    if (!normalized) return null;
    const digits = normalized.replace(prefix, "");
    if (options?.strictNumericSequence && !/^\d+$/.test(digits)) return null;
    const sequence = Number.parseInt(digits, 10);
    return Number.isFinite(sequence) && sequence > 0 ? sequence : null;
  };

  return {
    prefix,
    formatFromSequence,
    fallbackFromRecordId,
    normalize,
    parseSequence
  };
};
