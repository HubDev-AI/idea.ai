import type { RawEventInput } from './common/http.js';

const API_BASE = 'https://api.stackexchange.com/2.3';

interface SOOptions {
  tags?: string[];
  pageSize?: number;
  fetchImpl?: typeof fetch;
}

export async function fetchStackOverflow(opts: SOOptions = {}): Promise<RawEventInput[]> {
  const { tags = ['enterprise-integration', 'devops', 'saas'], pageSize = 25, fetchImpl = fetch } = opts;
  const tagStr = tags.join(';');
  const url = `${API_BASE}/questions?order=desc&sort=activity&tagged=${encodeURIComponent(tagStr)}&site=stackoverflow&pagesize=${pageSize}&filter=withbody`;

  const res = await fetchImpl(url);
  if (!res.ok) return [];

  const data = await res.json();
  const items = data.items ?? [];

  return items.map((q: any) => ({
    source: 'stackoverflow',
    source_item_id: `so-${q.question_id}`,
    source_timestamp: new Date(q.creation_date * 1000).toISOString(),
    text: `[${(q.tags ?? []).join(', ')}] ${q.title}`.slice(0, 2000),
    url: q.link,
  }));
}
