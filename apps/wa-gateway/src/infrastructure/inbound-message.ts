const unwrapInboundMessage = (message: any): any => {
  let current = message;
  let depth = 0;

  while (current && typeof current === "object" && depth < 8) {
    const next =
      current?.ephemeralMessage?.message ??
      current?.viewOnceMessage?.message ??
      current?.viewOnceMessageV2?.message ??
      current?.viewOnceMessageV2Extension?.message ??
      current?.documentWithCaptionMessage?.message ??
      current?.editedMessage?.message;

    if (!next || next === current) break;
    current = next;
    depth += 1;
  }

  return current;
};

export const getInboundMessageType = (message: any): string | undefined => {
  const unwrapped = unwrapInboundMessage(message);
  if (!unwrapped || typeof unwrapped !== "object") return undefined;
  return Object.keys(unwrapped)[0] ?? undefined;
};

export const getInboundText = (message: any): string => {
  const unwrapped = unwrapInboundMessage(message);
  return (
    unwrapped?.conversation ??
    unwrapped?.extendedTextMessage?.text ??
    unwrapped?.imageMessage?.caption ??
    unwrapped?.videoMessage?.caption ??
    unwrapped?.documentMessage?.caption ??
    ""
  );
};

export const hasInboundMedia = (message: any): boolean => {
  const unwrapped = unwrapInboundMessage(message);
  return Boolean(
    unwrapped?.imageMessage ||
      unwrapped?.videoMessage ||
      unwrapped?.audioMessage ||
      unwrapped?.documentMessage ||
      unwrapped?.stickerMessage
  );
};

export const getInboundContextInfo = (message: any): any => {
  const unwrapped = unwrapInboundMessage(message);
  return (
    unwrapped?.extendedTextMessage?.contextInfo ??
    unwrapped?.imageMessage?.contextInfo ??
    unwrapped?.videoMessage?.contextInfo ??
    unwrapped?.documentMessage?.contextInfo ??
    unwrapped?.stickerMessage?.contextInfo ??
    unwrapped?.audioMessage?.contextInfo ??
    unwrapped?.buttonsResponseMessage?.contextInfo ??
    unwrapped?.templateButtonReplyMessage?.contextInfo ??
    undefined
  );
};
