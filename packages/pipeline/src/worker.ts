import { QUEUE_NAMES, type QueueName } from './queues';

export const routeNextQueues = (jobName: string): QueueName[] => {
  if (jobName.startsWith('ingest:')) {
    return [QUEUE_NAMES.normalize];
  }

  if (jobName.startsWith('normalize:')) {
    return [QUEUE_NAMES.memoryIndex];
  }

  if (jobName.startsWith('memory:index')) {
    return [QUEUE_NAMES.scoreDemand, QUEUE_NAMES.scoreTiming, QUEUE_NAMES.scoreBuildability];
  }

  if (
    jobName.startsWith('score:demand') ||
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

/**
 * @deprecated Use `routeNextQueues` (plural) to avoid dropping fan-out routes.
 * This function only returns the first queue and silently drops the rest.
 */
export const routeNextQueue = (jobName: string): QueueName | null => {
  const next = routeNextQueues(jobName);
  if (next.length > 1) {
    console.warn(`routeNextQueue: dropping ${next.length - 1} fan-out queues for "${jobName}". Use routeNextQueues instead.`);
  }
  return next[0] ?? null;
};
