import { Queue, type QueueOptions } from 'bullmq';

export const QUEUE_NAMES = {
  ingestHourly: 'ingest.hourly',
  ingestDaily: 'ingest.daily',
  normalize: 'normalize',
  memoryIndex: 'memory.index',
  memoryWindow: 'memory.window',
  scorePain: 'score.pain',
  scoreTiming: 'score.timing',
  scoreBuildability: 'score.buildability',
  scoreAggregate: 'score.aggregate',
  rank: 'rank',
  publish: 'publish'
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const redisUrlFromEnv = (env: NodeJS.ProcessEnv = process.env): string =>
  env.REDIS_URL ?? 'redis://127.0.0.1:6379';

export const redisConnectionFromUrl = (redisUrl = redisUrlFromEnv()) => {
  const url = new URL(redisUrl);

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number(url.pathname.replace('/', '') || 0)
  };
};

export const buildQueueOptions = (redisUrl = redisUrlFromEnv()): QueueOptions => ({
  connection: redisConnectionFromUrl(redisUrl)
});

export const createQueue = (name: QueueName, redisUrl = redisUrlFromEnv()): Queue =>
  new Queue(name, buildQueueOptions(redisUrl));
