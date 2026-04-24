import locationMap from './dataforseo_location_map.json' with { type: 'json' };
import type { SerpQuery } from './dataforseo_serp_byo';

/**
 * Curated probe keywords for Wave 2 AIO-Survival Scorer.
 * These are starting probes — not pre-validated as AIO-resistant.
 */
export const SERP_PROBE_SEEDS: string[] = [
  'salary calculator',
  'payroll calculator',
  'VAT calculator',
  'stamp duty calculator',
  'tax calculator',
  'mortgage calculator',
  'BMI calculator',
  'invoice template',
  'business plan template',
  'NDA template',
  'employee timesheet template',
  'ROI calculator',
  'compound interest calculator',
  'currency converter',
  'unit converter',
];

/**
 * Build SERP queries by cross-multiplying matching location-map entries with keywords.
 *
 * @param targetLanguages  ISO 639-1 codes (or BCP-47 tags; base tag is extracted).
 * @param keywords         Search keywords to probe.
 */
export function buildSerpQueries(
  targetLanguages: string[],
  keywords: string[],
): SerpQuery[] {
  if (targetLanguages.length === 0 || keywords.length === 0) return [];

  // Normalize to ISO 639-1 base tags (lowercase).
  const normalizedTargets = new Set(
    targetLanguages.map((lang) => lang.split('-')[0].toLowerCase()),
  );

  const results: SerpQuery[] = [];

  for (const [key, entry] of Object.entries(
    locationMap as Record<string, { location_code: number; language_code: string }>,
  )) {
    let countryCode: string;
    let langCode: string;

    if (key.includes('_')) {
      // Composite key, e.g. CH_DE, CA_EN, BE_FR
      const parts = key.split('_');
      countryCode = parts[0];
      langCode = parts[1].toLowerCase();
    } else {
      countryCode = key;
      langCode = entry.language_code.toLowerCase();
    }

    if (!normalizedTargets.has(langCode)) continue;

    for (const keyword of keywords) {
      results.push({ keyword, country_code: countryCode, language_code: langCode });
    }
  }

  return results;
}
