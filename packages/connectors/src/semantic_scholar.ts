import type { RawEventInput } from './common/http.js';

const API_BASE = 'https://api.semanticscholar.org/graph/v1/paper/search';

const DEFAULT_TOPICS = [
  'AI agents',
  'retrieval augmented generation',
  'vector databases',
  'code generation',
  'developer tools machine learning',
  'SaaS automation',
  'large language model applications',
];

export type SemanticScholarOptions = {
  topics?: string[];
  yearRange?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
};

type Paper = {
  paperId: string;
  title: string | null;
  abstract: string | null;
  citationCount: number;
  year: number;
  venue?: string;
  url?: string;
};

export const fetchSemanticScholar = async (
  opts: SemanticScholarOptions = {},
): Promise<RawEventInput[]> => {
  const {
    topics = DEFAULT_TOPICS,
    yearRange = '2024-2026',
    limit = 5,
    fetchImpl = fetch,
  } = opts;

  const events: RawEventInput[] = [];

  for (const topic of topics) {
    try {
      const params = new URLSearchParams({
        query: topic,
        year: yearRange,
        fieldsOfStudy: 'Computer Science',
        fields: 'title,abstract,citationCount,year,venue,url',
        limit: String(limit),
      });

      const res = await fetchImpl(`${API_BASE}?${params.toString()}`);
      if (!res.ok) continue;

      const data = (await res.json()) as { data?: Paper[] };
      const papers = data.data ?? [];

      for (const paper of papers) {
        if (!paper.title) continue;

        const venueLabel = paper.venue ? ` [${paper.venue}]` : '';
        const abstractSnippet = paper.abstract ? ` — ${paper.abstract.slice(0, 200)}` : '';

        events.push({
          source: 'semantic_scholar',
          source_item_id: `scholar-${paper.paperId}`,
          source_timestamp: new Date().toISOString(),
          text: `${paper.title}${venueLabel} (${paper.year}, ${paper.citationCount} citations)${abstractSnippet}`,
          url: paper.url ?? `https://www.semanticscholar.org/paper/${paper.paperId}`,
          engagement_count: paper.citationCount,
        });
      }
    } catch {
      // Skip failed topic queries
    }
  }

  return events;
};
