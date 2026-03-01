import { z } from 'zod';
import { scoreSchema } from './signal';

export const memoryWindowSchema = z.enum(['7d', '30d', '90d']);

export const signalMemoryRecordSchema = z
  .object({
    signal_id: z.string().min(1),
    topic: z.string().min(1),
    source: z.string().min(1),
    canonical_text: z.string().min(1),
    observed_at: z.string().datetime(),
    pain: scoreSchema,
    timing: scoreSchema,
    buildability: scoreSchema,
    blended: scoreSchema,
    source_url: z.string().nullish()
  })
  .strict();

export const trendWindowSnapshotSchema = z
  .object({
    topic: z.string().min(1),
    source: z.string().min(1),
    window: memoryWindowSchema,
    count_signals: z.number().int().nonnegative(),
    avg_pain: scoreSchema,
    avg_timing: scoreSchema
  })
  .strict();

export const similarSignalMatchSchema = z
  .object({
    signal_id: z.string().min(1),
    distance: z.number().min(0),
    pain: scoreSchema,
    timing: scoreSchema,
    source: z.string().min(1),
    observed_at: z.string().datetime(),
    canonical_text: z.string().min(1)
  })
  .strict();

export type MemoryWindow = z.infer<typeof memoryWindowSchema>;
export type SignalMemoryRecord = z.infer<typeof signalMemoryRecordSchema>;
export type TrendWindowSnapshot = z.infer<typeof trendWindowSnapshotSchema>;
export type SimilarSignalMatch = z.infer<typeof similarSignalMatchSchema>;
