import { embedText } from '@idea/ai-runtime/src/ollama';
import type { SignalMemoryRecord } from '@idea/contracts/src/memory';

export type ScoredSignalInput = {
  signalId: string;
  topic: string;
  source: string;
  idea: string;
  snippet: string;
  text: string;
  observedAt: string;
  demand: number;
  timing: number;
  buildability: number;
  blended: number;
  virality: number;
  sourceUrl?: string | null;
};

export type SignalEmbeddingRecord = {
  signal_id: string;
  embedding: number[] | null;
  model: string;
};

const OLLAMA_EMBEDDING_MODEL = 'ollama-nomic-embed-text';

export const buildCanonicalText = ({ idea, snippet, text, topic }: Pick<ScoredSignalInput, 'idea' | 'snippet' | 'text' | 'topic'>): string =>
  [idea.trim(), snippet.trim(), text.trim(), `topic:${topic.trim()}`].filter(Boolean).join(' | ');

export const indexSignalMemory = async (
  input: ScoredSignalInput
): Promise<{ memoryRecord: SignalMemoryRecord; embeddingRecord: SignalEmbeddingRecord | null }> => {
  const canonicalText = buildCanonicalText(input);
  const ollamaEmbedding = await embedText(canonicalText, { fallbackToNull: true });

  return {
    memoryRecord: {
      signal_id: input.signalId,
      topic: input.topic,
      source: input.source,
      canonical_text: canonicalText,
      observed_at: input.observedAt,
      demand: input.demand,
      timing: input.timing,
      buildability: input.buildability,
      blended: input.blended,
      virality: input.virality,
      source_url: input.sourceUrl ?? null
    },
    embeddingRecord: ollamaEmbedding
      ? { signal_id: input.signalId, embedding: ollamaEmbedding, model: OLLAMA_EMBEDDING_MODEL }
      : null
  };
};
