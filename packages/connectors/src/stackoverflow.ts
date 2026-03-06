import type { RawEventInput } from './common/http.js';

const API_BASE = 'https://api.stackexchange.com/2.3';

interface SOOptions {
  tags?: string[];
  pageSize?: number;
  fetchImpl?: typeof fetch;
}

type SOQuestion = {
  question_id: number;
  title: string;
  tags?: string[];
  creation_date: number;
  link: string;
  view_count?: number;
  answer_count?: number;
  score?: number;
  is_answered?: boolean;
};

export async function fetchStackOverflow(opts: SOOptions = {}): Promise<RawEventInput[]> {
  const {
    tags = ['enterprise-integration', 'devops', 'saas', 'prisma', 'auth0', 'stripe', 'kubernetes', 'docker', 'aws', 'ai-agent'],
    pageSize = 25,
    fetchImpl = fetch,
  } = opts;
  const tagStr = tags.join(';');
  const url = `${API_BASE}/questions?order=desc&sort=activity&tagged=${encodeURIComponent(tagStr)}&site=stackoverflow&pagesize=${pageSize}&filter=withbody`;

  const res = await fetchImpl(url);
  if (!res.ok) return [];

  const data = await res.json();
  const items: SOQuestion[] = data.items ?? [];

  return items.map((q) => {
    const questionTags = q.tags ?? [];
    const unansweredLabel = q.is_answered === false ? ' [UNANSWERED]' : '';

    return {
      source: 'stackoverflow',
      source_item_id: `so-${q.question_id}`,
      source_timestamp: new Date(q.creation_date * 1000).toISOString(),
      text: `[${questionTags.join(', ')}]${unansweredLabel} ${q.title}`.slice(0, 2000),
      url: q.link,
      engagement_count: (q.view_count ?? 0) + (q.score ?? 0),
    };
  });
}
