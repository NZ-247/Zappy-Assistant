export const getInboundText = (message: any): string => {
  return message?.conversation ?? message?.extendedTextMessage?.text ?? message?.imageMessage?.caption ?? message?.videoMessage?.caption ?? "";
};

export const hasInboundMedia = (message: any): boolean =>
  Boolean(
    message?.imageMessage ||
      message?.videoMessage ||
      message?.audioMessage ||
      message?.documentMessage ||
      message?.stickerMessage ||
      message?.documentWithCaptionMessage
  );

export const getInboundContextInfo = (message: any): any =>
  message?.extendedTextMessage?.contextInfo ??
  message?.imageMessage?.contextInfo ??
  message?.videoMessage?.contextInfo ??
  message?.documentMessage?.contextInfo ??
  message?.stickerMessage?.contextInfo ??
  message?.audioMessage?.contextInfo ??
  message?.buttonsResponseMessage?.contextInfo ??
  message?.templateButtonReplyMessage?.contextInfo ??
  undefined;
