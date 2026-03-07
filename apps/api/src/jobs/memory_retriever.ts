import type {
  SignalMemoryRecord,
  TrendWindowSnapshot
} from '@idea/contracts/src/memory';
import type { MemoryQuery, MemoryRetriever } from '@idea/pipeline/src/memory/retrieve';
import { buildCanonicalText, type SignalEmbeddingRecord } from './memory_index';
import { refreshTrendWindows } from './memory_windows';

export type IndexedMemoryEntry = {
  memoryRecord: SignalMemoryRecord;
  embeddingRecord: SignalEmbeddingRecord | null;
};

const trendWindowsFor = (
  allRecords: SignalMemoryRecord[],
  query: MemoryQuery,
  now: Date
): TrendWindowSnapshot[] =>
  refreshTrendWindows(
    allRecords.filter((record) => record.topic === query.topic || record.source === query.source),
    now
  ).filter((entry) => entry.topic === query.topic && entry.source === query.source);

export const createInMemoryRetriever = (
  entries: IndexedMemoryEntry[],
  now = new Date()
): MemoryRetriever => {
  const allRecords = entries.map((entry) => entry.memoryRecord);

  return {
    findSimilar: async (_query: MemoryQuery) => {
      // In-memory retriever cannot do real similarity search without Ollama.
      // The Postgres retriever handles real similarity queries via pgvector.
      return [];
    },
    getTrendWindows: async (query: MemoryQuery) => trendWindowsFor(allRecords, query, now)
  };
};

export const buildRetrieverQueryText = (input: {
  idea: string;
  snippet: string;
  text: string;
  topic: string;
}): string =>
  buildCanonicalText({
    idea: input.idea,
    snippet: input.snippet,
    text: input.text,
    topic: input.topic
  });
