import type { RawEventInput } from '@idea/connectors/src/common/http';
import { describe, expect, it } from 'vitest';
import { findIdeaCandidates, isLowValueRecruitingEvent, selectEventsForScoring } from '../src/runtime/signal_quality';

const event = ({
  source,
  id,
  text,
  ts
}: {
  source: string;
  id: string;
  text: string;
  ts: string;
}): RawEventInput => ({
  source,
  source_item_id: id,
  source_timestamp: ts,
  text,
  url: `https://example.com/${source}/${id}`
});

describe('signal quality', () => {
  it('flags low-value recruiting posts from hiring sources', () => {
    expect(
      isLowValueRecruitingEvent(
        event({
          source: 'greenhouse',
          id: '1',
          ts: '2026-02-25T00:00:00.000Z',
          text: 'Account Executive - Enterprise\nWho we are\nAbout us\nResponsibilities\nApply now'
        })
      )
    ).toBe(true);
  });

  it('keeps non-recruiting operational pain signals', () => {
    expect(
      isLowValueRecruitingEvent(
        event({
          source: 'github_issues',
          id: '2',
          ts: '2026-02-25T00:00:00.000Z',
          text: 'Customers struggle with manual process and billing error incidents'
        })
      )
    ).toBe(false);
  });

  it('balances selected events by source quotas instead of first-come dominance', () => {
    const events: RawEventInput[] = [];

    for (let index = 0; index < 120; index += 1) {
      events.push(
        event({
          source: 'greenhouse',
          id: `g-${index}`,
          ts: `2026-02-25T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
          text: `Account Executive ${index}\nWho we are`
        })
      );
    }

    for (let index = 0; index < 40; index += 1) {
      events.push(
        event({
          source: 'github_issues',
          id: `gh-${index}`,
          ts: `2026-02-25T01:${String(index % 60).padStart(2, '0')}:00.000Z`,
          text: `Founders report costly onboarding friction ${index}`
        })
      );
    }

    for (let index = 0; index < 40; index += 1) {
      events.push(
        event({
          source: 'yc_companies',
          id: `yc-${index}`,
          ts: `2026-02-25T02:${String(index % 60).padStart(2, '0')}:00.000Z`,
          text: `Company profile mentions automation need ${index}`
        })
      );
    }

    const filtered = events.filter((entry) => !isLowValueRecruitingEvent(entry));
    const selected = selectEventsForScoring(filtered);
    const bySource = selected.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.source] = (acc[entry.source] ?? 0) + 1;
      return acc;
    }, {});

    // All non-recruiting events pass through (no cap)
    expect(selected).toHaveLength(filtered.length);
    expect(bySource.github_issues).toBeGreaterThan(0);
    expect(bySource.yc_companies).toBeGreaterThan(0);
    expect(bySource.greenhouse ?? 0).toBe(0);
  });

  it('detects idea candidates from non-recruiting high-score signals', () => {
    const candidates = findIdeaCandidates(
      [
        {
          idea: 'Automated SOC2 evidence collection for startups',
          score: 51.2,
          top_source: 'github_issues',
          snippet: 'Teams repeatedly fail audits due to manual evidence collection',
          next_action: 'validate_demand',
          updated_at: '2026-02-25T00:00:00.000Z',
          source_url: null
        },
        {
          idea: 'Account Executive, Enterprise',
          score: 80,
          top_source: 'greenhouse',
          snippet: 'Job post',
          next_action: 'validate_demand',
          updated_at: '2026-02-25T00:00:00.000Z',
          source_url: null
        }
      ],
      5
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.idea).toContain('SOC2');
  });
});

