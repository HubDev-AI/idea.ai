import type { RawEventInput } from './common/http.js';

const API_BASE = 'https://api.crunchbase.com/api/v4';

interface CrunchbaseOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  limit?: number;
}

export async function fetchCrunchbase(opts: CrunchbaseOptions): Promise<RawEventInput[]> {
  const { apiKey, fetchImpl = fetch, limit = 25 } = opts;
  if (!apiKey) return [];

  try {
    const url = `${API_BASE}/searches/organizations`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-cb-user-key': apiKey },
      body: JSON.stringify({
        field_ids: ['short_description', 'founded_on', 'categories', 'funding_total', 'identifier'],
        order: [{ field_id: 'founded_on', sort: 'desc' }],
        limit,
      }),
    });

    if (!res.ok) return [];
    const data = await res.json();
    const entities = data.entities ?? [];

    return entities.map((e: any) => {
      const props = e.properties ?? {};
      const id = e.identifier?.permalink ?? e.identifier?.value ?? 'unknown';
      const cats = (props.categories ?? []).map((c: any) => c.value).join(', ');
      const funding = props.funding_total?.value_usd
        ? `$${(props.funding_total.value_usd / 1_000_000).toFixed(1)}M`
        : 'undisclosed';

      return {
        source: 'crunchbase',
        source_item_id: `cb-${id}`,
        source_timestamp: props.founded_on ? new Date(props.founded_on).toISOString() : new Date().toISOString(),
        text: `[Crunchbase] ${id}: ${props.short_description ?? 'No description'}. Categories: ${cats}. Funding: ${funding}`.slice(0, 2000),
        url: `https://www.crunchbase.com/organization/${id}`,
      };
    });
  } catch {
    return [];
  }
}
