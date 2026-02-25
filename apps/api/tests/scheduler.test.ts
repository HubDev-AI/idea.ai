import { describe, expect, it } from 'vitest';
import { buildSchedulerPlan } from '../src/jobs/scheduler';

describe('scheduler', () => {
  it('enqueues hourly connectors every hour', () => {
    const plan = buildSchedulerPlan({
      HOURLY_CONNECTORS: 'hn,github_issues',
      DAILY_CONNECTORS: 'greenhouse,lever',
      GREENHOUSE_BOARD_TOKEN: 'acme',
      LEVER_SITE: 'acme'
    });

    expect(plan.hourly.cron).toBe('0 * * * *');
    expect(plan.hourly.connectors).toEqual(['hn', 'github_issues']);
  });

  it('enqueues daily connectors once per day', () => {
    const plan = buildSchedulerPlan({
      HOURLY_CONNECTORS: 'hn,github_issues',
      DAILY_CONNECTORS: 'greenhouse,lever,yc_companies,exa_byo,perigon_byo',
      PERIGON_API_KEY: 'configured',
      GREENHOUSE_BOARD_TOKEN: 'acme',
      LEVER_SITE: 'acme'
    });

    expect(plan.daily.cron).toBe('0 0 * * *');
    expect(plan.daily.connectors).toContain('greenhouse');
    expect(plan.daily.connectors).toContain('lever');
    expect(plan.daily.connectors).toContain('yc_companies');
  });

  it('does not schedule disabled BYO connector', () => {
    const plan = buildSchedulerPlan({
      HOURLY_CONNECTORS: 'hn,github_issues',
      DAILY_CONNECTORS: 'greenhouse,lever,exa_byo,perigon_byo',
      PERIGON_API_KEY: 'configured',
      GREENHOUSE_BOARD_TOKEN: 'acme',
      LEVER_SITE: 'acme'
    });

    expect(plan.daily.connectors).not.toContain('exa_byo');
    expect(plan.daily.connectors).toContain('perigon_byo');
  });
});
