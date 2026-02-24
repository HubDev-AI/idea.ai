import { describe, expect, it } from 'vitest';
import {
  parseIngestRawReceivedEvent,
  parseSignalPublishedEvent,
  parseSignalScoredEvent
} from '../src/events';

describe('event schemas', () => {
  it('parses ingest.raw.received', () => {
    const parsed = parseIngestRawReceivedEvent({
      event: 'ingest.raw.received',
      connector: 'hn',
      occurred_at: '2026-02-24T00:00:00.000Z',
      payload: {
        source: 'hacker_news',
        source_item_id: '123',
        source_timestamp: '2026-02-24T00:00:00.000Z',
        text: 'Users asking for easier SOC2 prep',
        url: 'https://news.ycombinator.com/item?id=123'
      }
    });

    expect(parsed.payload.source_item_id).toBe('123');
  });

  it('parses signal.scored', () => {
    const parsed = parseSignalScoredEvent({
      event: 'signal.scored',
      connector: 'pipeline',
      occurred_at: '2026-02-24T00:00:00.000Z',
      payload: {
        signal_id: 'sig_1',
        pain: 80,
        timing: 75,
        buildability: 60,
        blended: 74
      }
    });

    expect(parsed.payload.blended).toBe(74);
  });

  it('parses signal.published', () => {
    const parsed = parseSignalPublishedEvent({
      event: 'signal.published',
      connector: 'pipeline',
      occurred_at: '2026-02-24T00:00:00.000Z',
      payload: {
        signal_id: 'sig_1',
        idea: 'SOC2 prep copilot for startups',
        score: 74,
        top_source: 'hacker_news',
        snippet: 'Repeated pain around compliance checklists',
        next_action: 'validate_demand',
        updated_at: '2026-02-24T00:00:00.000Z'
      }
    });

    expect(parsed.payload.next_action).toBe('validate_demand');
  });

  it('rejects invalid payloads', () => {
    expect(() =>
      parseIngestRawReceivedEvent({
        event: 'ingest.raw.received',
        connector: 'hn',
        occurred_at: '2026-02-24T00:00:00.000Z',
        payload: {
          source: 'hacker_news',
          source_timestamp: '2026-02-24T00:00:00.000Z',
          text: 'missing source_item_id',
          url: 'https://news.ycombinator.com/item?id=124'
        }
      })
    ).toThrow();

    expect(() =>
      parseSignalScoredEvent({
        event: 'signal.scored',
        connector: 'pipeline',
        occurred_at: '2026-02-24T00:00:00.000Z',
        payload: {
          signal_id: 'sig_2',
          pain: 101,
          timing: 50,
          buildability: 50,
          blended: 70
        }
      })
    ).toThrow();
  });
});
