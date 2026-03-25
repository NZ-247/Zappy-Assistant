import { buildResponseActionId } from "./outbound/context.js";
import { handleAudioOutboundAction } from "./outbound/handlers/audio-action.js";
import { handleBasicOutboundAction } from "./outbound/handlers/basic-actions.js";
import { handleGroupAdminOutboundAction } from "./outbound/handlers/group-admin-action.js";
import { handleModerationOutboundAction } from "./outbound/handlers/moderation-action.js";
import { handleStickerOutboundAction } from "./outbound/handlers/sticker-action.js";
import type { ExecuteOutboundActionsInput } from "./outbound/types.js";

type OutboundHandler = (input: {
  runtime: ExecuteOutboundActionsInput;
  action: any;
  responseActionId: string;
}) => Promise<boolean>;

const outboundHandlers: OutboundHandler[] = [
  handleBasicOutboundAction,
  handleAudioOutboundAction,
  handleStickerOutboundAction,
  handleGroupAdminOutboundAction,
  handleModerationOutboundAction
];

export const executeOutboundActions = async (input: ExecuteOutboundActionsInput): Promise<void> => {
  for (let actionIndex = 0; actionIndex < input.actions.length; actionIndex += 1) {
    const action = input.actions[actionIndex];
    const responseActionId = buildResponseActionId(input, action, actionIndex);

    for (const handler of outboundHandlers) {
      const handled = await handler({ runtime: input, action, responseActionId });
      if (handled) break;
    }
  }
};
