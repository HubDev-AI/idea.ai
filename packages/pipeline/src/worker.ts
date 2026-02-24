import { QUEUE_NAMES, type QueueName } from './queues';

export const routeNextQueue = (jobName: string): QueueName | null => {
  if (jobName.startsWith('ingest:')) {
    return QUEUE_NAMES.normalize;
  }

  if (jobName.startsWith('normalize:')) {
    return QUEUE_NAMES.scoreTiming;
  }

  if (jobName.startsWith('score:')) {
    return QUEUE_NAMES.rank;
  }

  if (jobName.startsWith('rank:')) {
    return QUEUE_NAMES.publish;
  }

  return null;
};
