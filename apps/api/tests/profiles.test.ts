import { describe, expect, it } from 'vitest';
import { b2bProfile } from '../src/profiles/b2b.js';
import { consumerProfile } from '../src/profiles/consumer.js';
import { getProfile, loadProfiles } from '../src/profiles/index.js';

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

describe('b2b profile', () => {
  it('has scoring dimensions that sum to 1', () => {
    const sum = b2bProfile.scoring.dimensions.reduce((s, d) => s + d.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.001);
  });

  it('has B2B scoring dimensions', () => {
    const names = b2bProfile.scoring.dimensions.map(d => d.name);
    expect(names).toContain('enterprise_pain');
    expect(names).toContain('moat_potential');
    expect(names).not.toContain('virality');
  });

  it('has unique id different from consumer', () => {
    expect(b2bProfile.id).toBe('b2b');
    expect(b2bProfile.id).not.toBe(consumerProfile.id);
  });
});

describe('loadProfiles', () => {
  it('returns enabled profiles', () => {
    const profiles = loadProfiles();
    expect(profiles).toHaveLength(2);
    expect(profiles[0]!.id).toBe('consumer');
    expect(profiles[1]!.id).toBe('b2b');
  });

  it('getProfile returns correct profile', () => {
    expect(getProfile('consumer')).toBe(consumerProfile);
    expect(getProfile('b2b')).toBe(b2bProfile);
    expect(getProfile('nonexistent')).toBeUndefined();
  });
});
