import locationMap from './dataforseo_location_map.json' with { type: 'json' };

type LocationEntry = { location_code: number; language_code: string };
type LocationMap = Record<string, LocationEntry>;

const map = locationMap as LocationMap;

/**
 * Looks up DataForSEO location_code and language_code for a given (country_code, language_code) pair.
 * Returns null for unsupported combinations — callers should emit unsupported_locale telemetry.
 *
 * Lookup order:
 *  1. Composite key "{COUNTRY}_{LANG}" (e.g. "CH_DE", "BE_FR", "CA_EN")
 *  2. Simple country key (e.g. "DE", "PL", "BR")
 *  3. "pt-BR"-style BCP-47 tags: split on "-", try "{country}_{lang}" then "{country}"
 */
export const lookupDataForSeoLocale = (
  country_code: string,
  language_code: string
): LocationEntry | null => {
  const country = country_code.toUpperCase();
  const lang = language_code.toLowerCase();

  // Composite key first: covers multi-language countries
  const composite = `${country}_${lang.toUpperCase()}`;
  if (map[composite]) return map[composite];

  // Simple country key
  if (map[country]) return map[country];

  // BCP-47 tag like "pt-BR" or "zh-TW" passed as country_code
  if (country_code.includes('-')) {
    const [langPart, regionPart] = country_code.split('-');
    if (regionPart) {
      const region = regionPart.toUpperCase();
      const lang2 = (langPart ?? '').toLowerCase().toUpperCase();
      const composite2 = `${region}_${lang2}`;
      if (map[composite2]) return map[composite2];
      if (map[region]) return map[region];
    }
  }

  return null;
};
