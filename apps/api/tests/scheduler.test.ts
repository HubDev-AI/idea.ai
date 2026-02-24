import { describe, expect, it } from 'vitest';
import { buildSchedulerPlan } from '../src/jobs/scheduler';

describe('scheduler', () => {
  it('enqueues hourly connectors every hour', () => {
    const plan = buildSchedulerPlan({
      HOURLY_CONNECTORS: 'hn,github_issues',
      DAILY_CONNECTORS: 'greenhouse,lever'
    });

    expect(plan.hourly.cron).toBe('0 * * * *');
    expect(plan.hourly.connectors).toEqual(['hn', 'github_issues']);
  });

  it('enqueues daily connectors once per day', () => {
    const plan = buildSchedulerPlan({
      HOURLY_CONNECTORS: 'hn,github_issues',
      DAILY_CONNECTORS: 'greenhouse,lever,exa_byo,perigon_byo',
      PERIGON_API_KEY: 'configured'
    });

    expect(plan.daily.cron).toBe('0 0 * * *');
    expect(plan.daily.connectors).toContain('greenhouse');
    expect(plan.daily.connectors).toContain('lever');
  });

  it('does not schedule disabled BYO connector', () => {
    const plan = buildSchedulerPlan({
      HOURLY_CONNECTORS: 'hn,github_issues',
      DAILY_CONNECTORS: 'greenhouse,lever,exa_byo,perigon_byo',
      PERIGON_API_KEY: 'configured'
    });

    expect(plan.daily.connectors).not.toContain('exa_byo');
    expect(plan.daily.connectors).toContain('perigon_byo');
  });
});
