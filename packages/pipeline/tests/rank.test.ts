import { describe, expect, it } from 'vitest';
import { rankSignals } from '../src/rank';
import { recommendNextAction } from '../src/recommend_action';

describe('ranking', () => {
  it('sorts signals by blended score', () => {
    const ranked = rankSignals([
      { id: 'a', blended: 61, demand: 80, timing: 50, buildability: 40, virality: 0 },
      { id: 'b', blended: 88, demand: 85, timing: 90, buildability: 70, virality: 0 },
      { id: 'c', blended: 74, demand: 72, timing: 70, buildability: 80, virality: 0 }
    ]);

    expect(ranked.map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('returns one of the allowed next actions', () => {
    const action = recommendNextAction({ demand: 85, timing: 40, buildability: 70 });

    expect(['validate_demand', 'validate_pricing', 'validate_channel']).toContain(action);
  });
});
