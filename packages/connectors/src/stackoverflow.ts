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

  // StackExchange API treats semicolon-joined tags as AND (all required).
  // Query each tag separately and dedupe by question_id.
  const seen = new Set<number>();
  const results: RawEventInput[] = [];

  for (const tag of tags) {
    if (results.length >= pageSize) break;
    const url = `${API_BASE}/questions?order=desc&sort=activity&tagged=${encodeURIComponent(tag)}&site=stackoverflow&pagesize=5&filter=withbody`;
    try {
      const res = await fetchImpl(url);
      if (!res.ok) continue;
      const data = await res.json();
      for (const q of (data.items ?? []) as SOQuestion[]) {
        if (seen.has(q.question_id)) continue;
        seen.add(q.question_id);
        const questionTags = q.tags ?? [];
        const unansweredLabel = q.is_answered === false ? ' [UNANSWERED]' : '';
        results.push({
          source: 'stackoverflow',
          source_item_id: `so-${q.question_id}`,
          source_timestamp: new Date(q.creation_date * 1000).toISOString(),
          text: `[${questionTags.join(', ')}]${unansweredLabel} ${q.title}`.slice(0, 2000),
          url: q.link,
          engagement_count: (q.view_count ?? 0) + (q.score ?? 0),
        });
      }
    } catch {
      // Skip failed tag query
    }
  }

  return results.slice(0, pageSize);
}
