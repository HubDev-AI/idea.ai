import { z } from 'zod';
import { publishedSignalSchema, scoreSchema } from './signal';

const envelopeBaseSchema = z
  .object({
    connector: z.string().min(1),
    occurred_at: z.string().datetime()
  })
  .strict();

const rawEventPayloadSchema = z
  .object({
    source: z.string().min(1),
    source_item_id: z.string().min(1),
    source_timestamp: z.string().datetime(),
    text: z.string().min(1),
    url: z.string().url()
  })
  .strict();

const scoredSignalPayloadSchema = z
  .object({
    signal_id: z.string().min(1),
    demand: scoreSchema,
    timing: scoreSchema,
    buildability: scoreSchema,
    virality: scoreSchema,
    blended: scoreSchema
  })
  .strict();

export const ingestRawReceivedEventSchema = envelopeBaseSchema
  .extend({
    event: z.literal('ingest.raw.received'),
    payload: rawEventPayloadSchema
  })
  .strict();

export const signalScoredEventSchema = envelopeBaseSchema
  .extend({
    event: z.literal('signal.scored'),
    payload: scoredSignalPayloadSchema
  })
  .strict();

export const signalPublishedEventSchema = envelopeBaseSchema
  .extend({
    event: z.literal('signal.published'),
    payload: publishedSignalSchema
  })
  .strict();

export type IngestRawReceivedEvent = z.infer<typeof ingestRawReceivedEventSchema>;
export type SignalScoredEvent = z.infer<typeof signalScoredEventSchema>;
export type SignalPublishedEvent = z.infer<typeof signalPublishedEventSchema>;

export const parseIngestRawReceivedEvent = (input: unknown): IngestRawReceivedEvent =>
  ingestRawReceivedEventSchema.parse(input);

export const parseSignalScoredEvent = (input: unknown): SignalScoredEvent =>
  signalScoredEventSchema.parse(input);

export const parseSignalPublishedEvent = (input: unknown): SignalPublishedEvent =>
  signalPublishedEventSchema.parse(input);
