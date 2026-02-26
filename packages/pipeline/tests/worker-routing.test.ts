import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES } from '../src/queues';
import { routeNextQueue, routeNextQueues } from '../src/worker';

describe('worker routing', () => {
  it('routes ingest jobs to normalize queue', () => {
    expect(routeNextQueue('ingest:hn')).toBe(QUEUE_NAMES.normalize);
  });

  it('routes normalize jobs to memory indexing queue', () => {
    expect(routeNextQueue('normalize:raw')).toBe(QUEUE_NAMES.memoryIndex);
  });

  it('fans out memory indexed jobs into all scoring queues', () => {
    expect(routeNextQueues('memory:index:signal-1')).toEqual([
      QUEUE_NAMES.scorePain,
      QUEUE_NAMES.scoreTiming,
      QUEUE_NAMES.scoreBuildability
    ]);
  });

  it('routes scored judge jobs to aggregate queue', () => {
    expect(routeNextQueue('score:pain:signal-1')).toBe(QUEUE_NAMES.scoreAggregate);
    expect(routeNextQueue('score:timing:signal-1')).toBe(QUEUE_NAMES.scoreAggregate);
    expect(routeNextQueue('score:buildability:signal-1')).toBe(QUEUE_NAMES.scoreAggregate);
  });

  it('routes aggregate score jobs to rank queue', () => {
    expect(routeNextQueue('score:aggregate:signal-1')).toBe(QUEUE_NAMES.rank);
  });

  it('routes rank jobs to publish queue', () => {
    expect(routeNextQueue('rank:signals')).toBe(QUEUE_NAMES.publish);
  });
});
