import { describe, it, expect } from 'vitest';
import { consumerProfile } from '../src/profiles/consumer.js';
import { loadProfiles, getProfile } from '../src/profiles/index.js';

describe('consumer profile', () => {
  it('has scoring dimensions that sum to 1', () => {
    const sum = consumerProfile.scoring.dimensions.reduce((s, d) => s + d.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.001);
  });

  it('has all required fields', () => {
    expect(consumerProfile.id).toBe('consumer');
    expect(consumerProfile.prompts.identity).toBeTruthy();
    expect(consumerProfile.scoring.dimensions).toHaveLength(4);
    expect(consumerProfile.display.badge).toBe('Consumer');
  });

  it('has consumer scoring dimensions', () => {
    const names = consumerProfile.scoring.dimensions.map(d => d.name);
    expect(names).toEqual(['demand', 'timing', 'buildability', 'virality']);
  });
});

describe('loadProfiles', () => {
  it('returns enabled profiles', () => {
    const profiles = loadProfiles();
    expect(profiles.length).toBeGreaterThanOrEqual(1);
    expect(profiles[0].id).toBe('consumer');
  });

  it('getProfile returns correct profile', () => {
    expect(getProfile('consumer')).toBe(consumerProfile);
    expect(getProfile('nonexistent')).toBeUndefined();
  });
});
