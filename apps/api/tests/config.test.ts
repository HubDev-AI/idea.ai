import { describe, it, expect } from 'vitest';
import { loadRuntimeEnv } from '../src/config/env';

describe('loadRuntimeEnv - boringSitesLanguages', () => {
  it('parses comma-separated language codes', () => {
    const result = loadRuntimeEnv({ BORING_SITES_LANGUAGES: 'de,pt-BR,en' });
    expect(result.boringSitesLanguages).toEqual(['de', 'pt-BR', 'en']);
  });

  it('defaults to empty array when unset', () => {
    const result = loadRuntimeEnv({});
    expect(result.boringSitesLanguages).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    const result = loadRuntimeEnv({ BORING_SITES_LANGUAGES: '' });
    expect(result.boringSitesLanguages).toEqual([]);
  });
});

describe('loadRuntimeEnv - boringSitesKeywords', () => {
  it('parses comma-separated keywords', () => {
    const result = loadRuntimeEnv({ BORING_SITES_KEYWORDS: 'salary calculator,VAT calculator' });
    expect(result.boringSitesKeywords).toEqual(['salary calculator', 'VAT calculator']);
  });

  it('defaults to empty array when unset', () => {
    const result = loadRuntimeEnv({});
    expect(result.boringSitesKeywords).toEqual([]);
  });
});
