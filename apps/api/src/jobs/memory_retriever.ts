import type {
  SignalMemoryRecord,
  SimilarSignalMatch,
  TrendWindowSnapshot
} from '@idea/contracts/src/memory';
import type { MemoryQuery, MemoryRetriever } from '@idea/pipeline/src/memory/retrieve';
import { buildCanonicalText, buildLocalEmbedding, type SignalEmbeddingRecord } from './memory_index';
import { refreshTrendWindows } from './memory_windows';

export type IndexedMemoryEntry = {
  memoryRecord: SignalMemoryRecord;
  embeddingRecord: SignalEmbeddingRecord;
};

const cosineDistance = (left: number[], right: number[]): number => {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftMagnitude += l * l;
    rightMagnitude += r * r;
  }

  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  if (denominator === 0) {
    return 1;
  }

  const similarity = dot / denominator;
  return Math.min(1, Math.max(0, 1 - similarity));
};

const toSimilarMatch = (entry: IndexedMemoryEntry, distance: number): SimilarSignalMatch => ({
  signal_id: entry.memoryRecord.signal_id,
  distance: Math.round(distance * 10000) / 10000,
  demand: entry.memoryRecord.demand,
  timing: entry.memoryRecord.timing,
  source: entry.memoryRecord.source,
  observed_at: entry.memoryRecord.observed_at
});

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
    findSimilar: async (query: MemoryQuery) => {
      const queryEmbedding = buildLocalEmbedding(query.canonicalText);
      const limit = query.topK ?? 8;

      return entries
        .filter((entry) => entry.memoryRecord.topic === query.topic || entry.memoryRecord.source === query.source)
        .filter((entry) => entry.embeddingRecord.embedding !== null)
        .map((entry) =>
          toSimilarMatch(entry, cosineDistance(entry.embeddingRecord.embedding!, queryEmbedding))
        )
        .sort((left, right) => left.distance - right.distance)
        .slice(0, limit);
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
