import { z } from 'zod';

export const SIGNAL_VERSION = 'v1';

export const nextActionSchema = z.enum([
  'validate_demand',
  'validate_pricing',
  'validate_channel'
]);

export const scoreSchema = z.number().min(0).max(100);

export const publishedSignalSchema = z
  .object({
    signal_id: z.string().min(1),
    idea: z.string().min(1),
    score: scoreSchema,
    top_source: z.string().min(1),
    snippet: z.string().min(1),
    next_action: nextActionSchema,
    updated_at: z.string().datetime()
  })
  .strict();

export type NextAction = z.infer<typeof nextActionSchema>;
export type PublishedSignal = z.infer<typeof publishedSignalSchema>;
