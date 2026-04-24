// createRequire bypasses Node's CJS-to-ESM named-export detection (cjs-module-lexer),
// which fails on Node 20 for tslib.__exportStar chains used by bullmq's CJS dist.
// The bullmq ESM dist is not valid Node.js ESM (bare specifiers, no .js extensions),
// so we must load the CJS build explicitly at runtime.
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const _bullmq = _require('bullmq') as typeof import('bullmq');

export const QueueCtor: typeof import('bullmq').Queue = _bullmq.Queue;
