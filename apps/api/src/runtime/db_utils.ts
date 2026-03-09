import { join } from 'node:path';

/** Convert a number[] to the `[x,y,z]` literal PostgreSQL expects for vector columns. */
export const toVectorLiteral = (embedding: number[]): string =>
  `[${embedding.map((v) => (Number.isFinite(v) ? v : 0)).join(',')}]`;

/** Canonical path for execution logs, relative to process cwd. */
export const EXEC_LOG_DIR = join(process.cwd(), 'logs', 'executions');
