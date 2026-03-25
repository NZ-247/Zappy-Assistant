import type { ResponseAction } from "../../../../../pipeline/actions.js";
import type { PipelineContext } from "../../../../../pipeline/context.js";
import type { AudioModuleConfigPort } from "../../ports.js";
import { buildTranscribeAndRouteAction } from "./build-audio-transcription-action.js";

const normalizeMessageType = (value?: string): string => (value ?? "").trim().toLowerCase();
const isAudioMessageType = (value?: string): boolean => normalizeMessageType(value) === "audiomessage";

export const maybeBuildAutoAudioAction = (input: {
  ctx: PipelineContext;
  config: AudioModuleConfigPort;
}): ResponseAction[] => {
  const { ctx, config } = input;
  if (!config.capabilityEnabled) return [];
  if (!config.autoTranscribeInboundAudio) return [];
  if (ctx.event.normalizedText) return [];
  if (!ctx.event.hasMedia) return [];
  if (!isAudioMessageType(ctx.event.rawMessageType)) return [];
  if (ctx.event.isGroup && !ctx.isReplyToBot && !ctx.isBotMentioned) return [];

  return [
    buildTranscribeAndRouteAction({
      source: "inbound",
      commandPrefix: config.commandPrefix,
      allowCommandDispatch: config.allowDynamicCommandDispatch
    })
  ];
};
