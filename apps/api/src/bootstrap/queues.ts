import { QUEUE_NAMES, redisUrlFromEnv } from '@idea/pipeline/src/queues';

export const bootstrapQueueConfig = (env: NodeJS.ProcessEnv = process.env) => ({
  redisUrl: redisUrlFromEnv(env),
  queues: Object.values(QUEUE_NAMES)
});
