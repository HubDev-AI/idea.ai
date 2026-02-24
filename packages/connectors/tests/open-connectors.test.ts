import { describe, expect, it } from 'vitest';
import { fetchGithubIssueEvents } from '../src/github_issues';
import { fetchGreenhouseJobEvents } from '../src/greenhouse';
import { fetchHnEvents } from '../src/hn';
import { fetchLeverJobEvents } from '../src/lever';

const assertRawShape = (item: Record<string, unknown>) => {
  expect(item.source_item_id).toBeTypeOf('string');
  expect(item.source_timestamp).toBeTypeOf('string');
  expect(item.text).toBeTypeOf('string');
  expect(item.url).toBeTypeOf('string');
};

describe('open connectors', () => {
  it('normalizes Hacker News items', async () => {
    const events = await fetchHnEvents(async () => [
      {
        id: 123,
        time: 1700000000,
        title: 'Founders want better analytics setup',
        text: 'Need lightweight event tracking',
        url: 'https://example.com/hn/123'
      }
    ]);

    expect(events).toHaveLength(1);
    assertRawShape(events[0] as unknown as Record<string, unknown>);
  });

  it('normalizes GitHub issues', async () => {
    const events = await fetchGithubIssueEvents(async () => [
      {
        id: 999,
        number: 42,
        created_at: '2026-02-24T00:00:00.000Z',
        title: 'Recurring billing edge case',
        body: 'Customers fail checkout with edge plan changes',
        html_url: 'https://github.com/acme/project/issues/42'
      }
    ]);

    expect(events).toHaveLength(1);
    assertRawShape(events[0] as unknown as Record<string, unknown>);
  });

  it('normalizes Greenhouse jobs', async () => {
    const events = await fetchGreenhouseJobEvents(async () => ({
      jobs: [
        {
          id: 555,
          updated_at: '2026-02-24T00:00:00.000Z',
          title: 'Customer Success Operations Lead',
          absolute_url: 'https://boards.greenhouse.io/acme/jobs/555',
          content: 'Scaling support operations for SaaS teams'
        }
      ]
    }));

    expect(events).toHaveLength(1);
    assertRawShape(events[0] as unknown as Record<string, unknown>);
  });

  it('normalizes Lever jobs', async () => {
    const events = await fetchLeverJobEvents(async () => [
      {
        id: 'lever-77',
        createdAt: 1700000000000,
        text: 'Revenue Operations Manager',
        descriptionPlain: 'Owning funnel tooling and forecasting',
        hostedUrl: 'https://jobs.lever.co/acme/lever-77'
      }
    ]);

    expect(events).toHaveLength(1);
    assertRawShape(events[0] as unknown as Record<string, unknown>);
  });
});
