import { QUEUE_NAMES, type QueueName } from './queues';

export const routeNextQueues = (jobName: string): QueueName[] => {
  if (jobName.startsWith('ingest:')) {
    return [QUEUE_NAMES.normalize];
  }

  if (jobName.startsWith('normalize:')) {
    return [QUEUE_NAMES.memoryIndex];
  }

  if (jobName.startsWith('memory:index')) {
    return [QUEUE_NAMES.scorePain, QUEUE_NAMES.scoreTiming, QUEUE_NAMES.scoreBuildability];
  }

  if (
    jobName.startsWith('score:pain') ||
    jobName.startsWith('score:timing') ||
    jobName.startsWith('score:buildability')
  ) {
    return [QUEUE_NAMES.scoreAggregate];
  }

  if (jobName.startsWith('score:aggregate')) {
    return [QUEUE_NAMES.rank];
  }

  if (jobName.startsWith('memory:window')) {
    return [QUEUE_NAMES.scoreAggregate];
  }

  if (jobName.startsWith('rank:')) {
    return [QUEUE_NAMES.publish];
  }

  return [];
};

export const routeNextQueue = (jobName: string): QueueName | null => {
  const next = routeNextQueues(jobName);
  return next[0] ?? null;
};
