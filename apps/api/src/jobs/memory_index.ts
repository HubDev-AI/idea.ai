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
  pain: number;
  timing: number;
  buildability: number;
  blended: number;
};

export type SignalEmbeddingRecord = {
  signal_id: string;
  embedding: number[] | null;
  model: string;
};

const EMBEDDING_DIMENSION = 32;
const EMBEDDING_MODEL = 'local-hash-v1';
const OLLAMA_EMBEDDING_MODEL = 'ollama-nomic-embed-text';

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const hashToken = (token: string): number => {
  let hash = 2166136261;

  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash);
};

const normalizeVector = (vector: number[]): number[] => {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => Math.round((value / magnitude) * 1_000_000) / 1_000_000);
};

export const buildCanonicalText = ({ idea, snippet, text, topic }: Pick<ScoredSignalInput, 'idea' | 'snippet' | 'text' | 'topic'>): string =>
  [idea.trim(), snippet.trim(), text.trim(), `topic:${topic.trim()}`].filter(Boolean).join(' | ');

export const buildLocalEmbedding = (text: string, dimension = EMBEDDING_DIMENSION): number[] => {
  const vector = Array.from({ length: dimension }, () => 0);

  for (const token of tokenize(text)) {
    const index = hashToken(token) % dimension;
    vector[index] = (vector[index] ?? 0) + 1;
  }

  return normalizeVector(vector);
};

export const indexSignalMemory = async (
  input: ScoredSignalInput
): Promise<{ memoryRecord: SignalMemoryRecord; embeddingRecord: SignalEmbeddingRecord }> => {
  const canonicalText = buildCanonicalText(input);
  const embedding = await embedText(canonicalText, { fallbackToNull: true });

  return {
    memoryRecord: {
      signal_id: input.signalId,
      topic: input.topic,
      source: input.source,
      canonical_text: canonicalText,
      observed_at: input.observedAt,
      pain: input.pain,
      timing: input.timing,
      buildability: input.buildability,
      blended: input.blended
    },
    embeddingRecord: {
      signal_id: input.signalId,
      embedding,
      model: embedding ? OLLAMA_EMBEDDING_MODEL : EMBEDDING_MODEL
    }
  };
};
