import { describe, it, expect } from 'vitest';
import { buildSerpQueries, SERP_PROBE_SEEDS } from '../src/serp_query_builder';

describe('buildSerpQueries', () => {
  // 1. Empty targetLanguages
  it('returns [] when targetLanguages is empty', () => {
    expect(buildSerpQueries([], ['keyword'])).toEqual([]);
  });

  // 2. Empty keywords
  it('returns [] when keywords is empty', () => {
    expect(buildSerpQueries(['de'], [])).toEqual([]);
  });

  // 3. German single keyword — DE, AT, CH_DE all match
  it('includes DE, AT, and CH for language "de"', () => {
    const result = buildSerpQueries(['de'], ['salary calculator']);
    expect(result.some((r) => r.country_code === 'DE')).toBe(true);
    expect(result.some((r) => r.country_code === 'AT')).toBe(true);
    expect(result.some((r) => r.country_code === 'CH')).toBe(true);
    result
      .filter((r) => ['DE', 'AT', 'CH'].includes(r.country_code))
      .forEach((r) => {
        expect(r.language_code).toBe('de');
        expect(r.keyword).toBe('salary calculator');
      });
  });

  // 4. English single keyword — US, GB, AU, CA (from CA_EN) all match
  it('includes US, GB, AU, and CA for language "en"', () => {
    const result = buildSerpQueries(['en'], ['vat']);
    expect(result.some((r) => r.country_code === 'US')).toBe(true);
    expect(result.some((r) => r.country_code === 'GB')).toBe(true);
    expect(result.some((r) => r.country_code === 'AU')).toBe(true);
    expect(result.some((r) => r.country_code === 'CA')).toBe(true);
    result
      .filter((r) => ['US', 'GB', 'AU', 'CA'].includes(r.country_code))
      .forEach((r) => {
        expect(r.language_code).toBe('en');
      });
  });

  // 5. BCP-47 tag pt-BR normalises to 'pt', matches both BR and PT
  it('handles BCP-47 tag: pt-BR → includes entries for BR and PT', () => {
    const result = buildSerpQueries(['pt-BR'], ['keyword']);
    expect(result.some((r) => r.country_code === 'BR')).toBe(true);
    expect(result.some((r) => r.country_code === 'PT')).toBe(true);
    result.forEach((r) => expect(r.language_code).toBe('pt'));
  });

  // 6. Multiple languages — German + English entries both present
  it('handles multiple languages: de + en', () => {
    const result = buildSerpQueries(['de', 'en'], ['keyword']);
    // German
    expect(result.some((r) => r.country_code === 'DE')).toBe(true);
    expect(result.some((r) => r.country_code === 'AT')).toBe(true);
    expect(result.some((r) => r.country_code === 'CH' && r.language_code === 'de')).toBe(true);
    // English
    expect(result.some((r) => r.country_code === 'US')).toBe(true);
    expect(result.some((r) => r.country_code === 'GB')).toBe(true);
  });

  // 7. Multiple keywords — DE, AT, CH_DE each × 2 = 6 minimum results
  it('cross-multiplies locations with multiple keywords', () => {
    const result = buildSerpQueries(['de'], ['k1', 'k2']);
    // 3 German-speaking locations (DE, AT, CH) × 2 keywords = 6
    const deGroup = result.filter((r) => ['DE', 'AT', 'CH'].includes(r.country_code));
    expect(deGroup.length).toBe(6);
    expect(deGroup.filter((r) => r.keyword === 'k1').length).toBe(3);
    expect(deGroup.filter((r) => r.keyword === 'k2').length).toBe(3);
  });

  // 8. Unknown language → []
  it('returns [] for unknown language code', () => {
    expect(buildSerpQueries(['xx'], ['keyword'])).toEqual([]);
  });

  // 9. Case-insensitive: 'DE' input same result count as 'de'
  it('is case-insensitive in language input', () => {
    const lower = buildSerpQueries(['de'], ['keyword']);
    const upper = buildSerpQueries(['DE'], ['keyword']);
    expect(upper.length).toBe(lower.length);
  });
});

// 10. SERP_PROBE_SEEDS
describe('SERP_PROBE_SEEDS', () => {
  it('is a non-empty string array', () => {
    expect(Array.isArray(SERP_PROBE_SEEDS)).toBe(true);
    expect(SERP_PROBE_SEEDS.length).toBeGreaterThan(0);
    SERP_PROBE_SEEDS.forEach((seed) => expect(typeof seed).toBe('string'));
  });
});
