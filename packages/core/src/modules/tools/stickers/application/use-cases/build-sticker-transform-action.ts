import type { StickerSourceMediaType, StickerTransformAction, StickerTransformSource } from "../../../../../pipeline/actions.js";
import type { StickerCommandMetadata } from "../../ports.js";

export const buildMediaToStickerAction = (
  input: StickerCommandMetadata & { source: StickerTransformSource; mediaType: StickerSourceMediaType }
): StickerTransformAction => ({
  kind: "sticker_transform",
  operation: "media_to_sticker",
  source: input.source,
  sourceMediaType: input.mediaType,
  author: input.author,
  packName: input.packName
});

export const buildStickerToImageAction = (input: { source: StickerTransformSource }): StickerTransformAction => ({
  kind: "sticker_transform",
  operation: "sticker_to_image",
  source: input.source
});

export const buildRenameStickerMetadataAction = (input: StickerCommandMetadata & { source: StickerTransformSource }): StickerTransformAction => ({
  kind: "sticker_transform",
  operation: "sticker_rename_metadata",
  source: input.source,
  author: input.author,
  packName: input.packName
});

export const buildImageToStickerAction = (input: StickerCommandMetadata & { source: StickerTransformSource }): StickerTransformAction =>
  buildMediaToStickerAction({ ...input, mediaType: "image" });
