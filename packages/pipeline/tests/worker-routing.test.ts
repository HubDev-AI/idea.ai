import { describe, expect, it } from 'vitest';
import { routeNextQueue } from '../src/worker';
import { QUEUE_NAMES } from '../src/queues';

describe('worker routing', () => {
  it('routes ingest jobs to normalize queue', () => {
    expect(routeNextQueue('ingest:hn')).toBe(QUEUE_NAMES.normalize);
  });

  it('routes normalize jobs to score queue', () => {
    expect(routeNextQueue('normalize:raw')).toBe(QUEUE_NAMES.scoreTiming);
  });

  it('routes score jobs to rank queue', () => {
    expect(routeNextQueue('score:pain')).toBe(QUEUE_NAMES.rank);
  });

  it('routes rank jobs to publish queue', () => {
    expect(routeNextQueue('rank:signals')).toBe(QUEUE_NAMES.publish);
  });
});
