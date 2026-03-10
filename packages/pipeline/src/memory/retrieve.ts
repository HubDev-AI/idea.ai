import type { SimilarSignalMatch, TrendWindowSnapshot } from '@idea/contracts/src/memory';

export type MemoryQuery = {
  topic: string;
  source: string;
  canonicalText: string;
  topK?: number;
  /** Pre-computed embedding vector — when provided, findSimilar skips the Ollama call */
  embedding?: number[];
};

export type MemoryRetriever = {
  findSimilar: (query: MemoryQuery) => Promise<SimilarSignalMatch[]>;
  getTrendWindows: (query: MemoryQuery) => Promise<TrendWindowSnapshot[]>;
};

export type MemoryContext = {
  similar: SimilarSignalMatch[];
  windows: TrendWindowSnapshot[];
};

export const emptyMemoryContext: MemoryContext = {
  similar: [],
  windows: []
};

export const loadMemoryContext = async (
  retriever: MemoryRetriever | undefined,
  query: MemoryQuery
): Promise<MemoryContext> => {
  if (!retriever) {
    return emptyMemoryContext;
  }

  const [similar, windows] = await Promise.all([
    retriever.findSimilar({ ...query, topK: query.topK ?? 8 }),
    retriever.getTrendWindows(query)
  ]);

  return {
    similar,
    windows
  };
};
