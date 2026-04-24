import { describe, expect, it } from 'vitest';
import { lookupDataForSeoLocale } from '../src/dataforseo_location_helpers';

describe('lookupDataForSeoLocale', () => {
  it('returns correct entry for simple country code', () => {
    const result = lookupDataForSeoLocale('DE', 'de');
    expect(result).toEqual({ location_code: 2276, language_code: 'de' });
  });

  it('returns correct entry for PL', () => {
    const result = lookupDataForSeoLocale('PL', 'pl');
    expect(result).toEqual({ location_code: 2616, language_code: 'pl' });
  });

  it('returns correct entry for BR', () => {
    const result = lookupDataForSeoLocale('BR', 'pt');
    expect(result).toEqual({ location_code: 2076, language_code: 'pt' });
  });

  it('returns null for unknown country code', () => {
    expect(lookupDataForSeoLocale('XX', 'en')).toBeNull();
  });

  it('normalizes country code to uppercase', () => {
    expect(lookupDataForSeoLocale('de', 'de')).toEqual({ location_code: 2276, language_code: 'de' });
  });

  it('normalizes mixed-case country code', () => {
    expect(lookupDataForSeoLocale('De', 'de')).toEqual({ location_code: 2276, language_code: 'de' });
  });

  it('resolves composite key for multi-language country (CH_DE)', () => {
    const result = lookupDataForSeoLocale('CH', 'de');
    expect(result).toEqual({ location_code: 2756, language_code: 'de' });
  });

  it('resolves composite key for multi-language country (CH_FR)', () => {
    const result = lookupDataForSeoLocale('CH', 'fr');
    expect(result).toEqual({ location_code: 2756, language_code: 'fr' });
  });

  it('resolves composite key for BE_NL', () => {
    expect(lookupDataForSeoLocale('BE', 'nl')).toEqual({ location_code: 2056, language_code: 'nl' });
  });

  it('resolves composite key for CA_FR', () => {
    expect(lookupDataForSeoLocale('CA', 'fr')).toEqual({ location_code: 2124, language_code: 'fr' });
  });

  it('handles pt-BR BCP-47 tag as country_code', () => {
    const result = lookupDataForSeoLocale('pt-BR', 'pt');
    expect(result).not.toBeNull();
    expect(result?.location_code).toBe(2076);
  });

  it('falls back to simple country key when composite not matched', () => {
    // US has only simple key; passing an unknown language falls back to simple
    const result = lookupDataForSeoLocale('US', 'es');
    expect(result).toEqual({ location_code: 2840, language_code: 'en' });
  });

  it('returns null for entirely unknown input', () => {
    expect(lookupDataForSeoLocale('ZZ', 'zz')).toBeNull();
  });
});
