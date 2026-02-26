import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput, withRetry } from './common/http';

type YcAlgoliaConfig = {
  app: string;
  key: string;
};

type YcCompanyHit = {
  id?: number;
  slug?: string;
  name?: string;
  one_liner?: string;
  long_description?: string;
  website?: string;
  batch?: string;
  launched_at?: string;
};

type YcConfigLoader = () => Promise<YcAlgoliaConfig>;
type YcHitsLoader = (config: YcAlgoliaConfig, limit: number) => Promise<YcCompanyHit[]>;

const algoliaOptsPattern = /window\.AlgoliaOpts\s*=\s*(\{[^;]+\})/;

const defaultConfigLoader: YcConfigLoader = async () => {
  const response = await fetch('https://www.ycombinator.com/companies');

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for https://www.ycombinator.com/companies`);
  }

  const html = await response.text();

  const matched = String(html).match(algoliaOptsPattern);

  if (!matched?.[1]) {
    throw new Error('Failed to parse YC Algolia credentials from companies page');
  }

  const parsed = JSON.parse(matched[1]) as Partial<YcAlgoliaConfig>;

  if (!parsed.app || !parsed.key) {
    throw new Error('YC Algolia options missing app/key');
  }

  return {
    app: parsed.app,
    key: parsed.key
  };
};

const defaultHitsLoader: YcHitsLoader = async (config, limit) => {
  const response = await fetchJsonWithRetry<{ hits?: YcCompanyHit[] }>(
    `https://${config.app}-dsn.algolia.net/1/indexes/YCCompany_production/query`,
    {
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-algolia-application-id': config.app,
          'x-algolia-api-key': config.key
        },
        body: JSON.stringify({
          params: `hitsPerPage=${limit}&query=`
        })
      }
    }
  );

  return response.hits ?? [];
};

const defaultTimestamp = (): string => new Date().toISOString();

const toSourceTimestamp = (value: string | undefined): string => {
  if (!value) {
    return defaultTimestamp();
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return defaultTimestamp();
  }

  return date.toISOString();
};

const toText = (hit: YcCompanyHit): string => {
  const name = (hit.name ?? '').trim();
  const oneLiner = (hit.one_liner ?? '').trim();
  const description = (hit.long_description ?? '').trim();
  const batch = (hit.batch ?? '').trim();

  const parts: string[] = [];
  if (oneLiner) {
    parts.push(`New YC startup (${batch || 'recent'}): ${oneLiner}`);
  }
  if (description) {
    parts.push(`Problem context: ${description.slice(0, 300)}`);
  }
  if (name) {
    parts.push(`Company: ${name}`);
  }

  return parts.join('\n');
};

const toUrl = (hit: YcCompanyHit): string => {
  if (hit.website) {
    return hit.website;
  }

  if (hit.slug) {
    return `https://www.ycombinator.com/companies/${hit.slug}`;
  }

  return 'https://www.ycombinator.com/companies';
};

export const fetchYcCompanyEvents = async (
  loadConfig: YcConfigLoader = defaultConfigLoader,
  loadHits: YcHitsLoader = defaultHitsLoader,
  limit = OPEN_CONNECTOR_LIMITS.yc_companies
): Promise<RawEventInput[]> => {
  const config = await withRetry(() => loadConfig());
  const hits = await withRetry(() => loadHits(config, limit));

  return hits.slice(0, limit).map((hit, index) => ({
    source: 'yc_companies',
    source_item_id: hit.slug ?? `yc:${hit.id ?? index}`,
    source_timestamp: toSourceTimestamp(hit.launched_at),
    text: toText(hit),
    url: toUrl(hit)
  }));
};
