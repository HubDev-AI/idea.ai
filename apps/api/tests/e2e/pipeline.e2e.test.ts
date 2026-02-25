import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchHnEvents } from '@idea/connectors/src/hn';
import { scoreSignal } from '../../src/jobs/score';
import { rankAndPreparePublish } from '../../src/jobs/rank_publish';
import { buildServer } from '../../src/server';

describe('pipeline e2e', () => {
  it('simulates ingest -> normalize -> score -> rank -> publish and exposes one feed row', async () => {
    const rawEvents = await fetchHnEvents(async () => [
      {
        id: 101,
        time: 1700000000,
        title: 'Customers struggle with SOC2 workflow',
        text: 'urgent manual and costly process across teams',
        url: 'https://example.com/hn/101'
      }
    ]);

    const normalized = rawEvents.map((event) => ({
      id: `signal-${event.source_item_id}`,
      idea: 'SOC2 workflow copilot',
      top_source: event.source,
      snippet: event.text.slice(0, 80),
      source_url: event.url,
      text: event.text
    }));

    const scored = normalized.map((signal) => {
      const score = scoreSignal({
        text: signal.text,
        judgeScores: [60, 70, 65],
        memoryContext: {
          similar: [
            {
              signal_id: 'history-1',
              distance: 0.24,
              pain: 74,
              timing: 68,
              source: 'hn',
              observed_at: '2026-02-20T00:00:00.000Z'
            }
          ],
          windows: [
            {
              topic: 'compliance',
              source: 'hn',
              window: '7d',
              count_signals: 10,
              avg_pain: 72,
              avg_timing: 65
            },
            {
              topic: 'compliance',
              source: 'hn',
              window: '30d',
              count_signals: 14,
              avg_pain: 63,
              avg_timing: 57
            },
            {
              topic: 'compliance',
              source: 'hn',
              window: '90d',
              count_signals: 24,
              avg_pain: 54,
              avg_timing: 49
            }
          ]
        }
      });

      return {
        id: signal.id,
        idea: signal.idea,
        top_source: signal.top_source,
        snippet: signal.snippet,
        source_url: signal.source_url,
        pain: score.pain,
        timing: score.timing,
        buildability: score.buildability,
        blended: score.blended
      };
    });

    const published = rankAndPreparePublish(scored);

    const server = buildServer({
      listSignals: async () => published,
      listConnectors: async () => []
    });

    const response = await server.inject({ method: 'GET', url: '/v1/signals' });
    await server.close();

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].idea).toBe('SOC2 workflow copilot');
    expect(scored[0]?.pain).toBeGreaterThan(55);
    expect(scored[0]?.timing).toBeGreaterThan(45);

    const baselineMetricsPath = join(process.cwd(), 'docs/metrics/v1-baseline.md');
    const baselineMetrics = await readFile(baselineMetricsPath, 'utf8');
    expect(baselineMetrics).toContain('signals/day');
  });
});
