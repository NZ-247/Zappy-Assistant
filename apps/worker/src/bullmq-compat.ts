// createRequire bypasses Node's CJS-to-ESM named-export detection (cjs-module-lexer),
// which fails on Node 20 for tslib.__exportStar chains used by bullmq's CJS dist.
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const _bullmq = _require('bullmq') as typeof import('bullmq');

export const { Worker } = _bullmq;
export type { Worker as WorkerType, Job, Processor } from 'bullmq';
