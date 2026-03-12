import type { ToolAction } from "../../../pipeline/types.js";

export interface PendingToolContext {
  pendingTool: ToolAction;
  missing: string[];
  provided?: Record<string, unknown>;
  summary?: string;
}
