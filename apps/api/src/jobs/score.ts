import type { RunPromptResult } from '@idea/ai-runtime/src/types';
import {
  applyPainMemory,
  applyTimingMemory,
  momentumScoreFromWindows,
  noveltyScoreFromDistances,
  persistenceScoreFromWindows,
  saturationScoreFromDistances
} from '@idea/pipeline/src/memory/features';
import {
  emptyMemoryContext,
  loadMemoryContext,
  type MemoryContext,
  type MemoryRetriever
} from '@idea/pipeline/src/memory/retrieve';
import { type AiScoreResult, aiScoreSignal } from '@idea/pipeline/src/scoring/ai_score';
import { blendedScore, blendedScoreWithWeights } from '@idea/pipeline/src/scoring/blend';
import { scoreBuildability } from '@idea/pipeline/src/scoring/buildability';
import type { WeightConfig } from '@idea/pipeline/src/scoring/weight_optimizer';
import { scorePain } from '@idea/pipeline/src/scoring/pain';
import { scoreTiming } from '@idea/pipeline/src/scoring/timing';

export type ScoreSignalInput = {
  text: string;
  judgeScores: [number, number, number];
  memoryContext?: MemoryContext;
  baseDemand?: number;
  baseTiming?: number;
  baseVirality?: number;
  weights?: WeightConfig;
};

export const scoreSignal = ({
  text,
  judgeScores,
  memoryContext = emptyMemoryContext,
  baseDemand,
  baseTiming,
  baseVirality,
  weights
}: ScoreSignalInput) => {
  const demandCurrent = Number.isFinite(baseDemand) ? Math.max(0, Math.min(100, Number(baseDemand))) : scorePain(text);
  const timingCurrent = Number.isFinite(baseTiming)
    ? Math.max(0, Math.min(100, Number(baseTiming)))
    : scoreTiming(text);
  const buildability = scoreBuildability(judgeScores);
  const distances = memoryContext.similar.map((entry) => entry.distance);
  const novelty = noveltyScoreFromDistances(distances);
  const saturation = saturationScoreFromDistances(distances);
  const persistence = persistenceScoreFromWindows(memoryContext.windows);
  const momentum = momentumScoreFromWindows(memoryContext.windows);
  const demand = applyPainMemory(demandCurrent, persistence);
  const timing = applyTimingMemory(timingCurrent, momentum, novelty, saturation);

  const virality = Number.isFinite(baseVirality) ? Math.max(0, Math.min(100, Number(baseVirality))) : 0;
  const scores = { demand, timing, buildability, virality };

  return {
    demand,
    timing,
    buildability,
    virality,
    blended: weights ? blendedScoreWithWeights(scores, weights) : blendedScore(scores),
    memory: {
      novelty,
      persistence,
      momentum,
      saturation
    }
  };
};

export const scoreSignalWithRetriever = async ({
  text,
  judgeScores,
  topic,
  source,
  canonicalText,
  memoryRetriever,
  topK,
  baseDemand,
  baseTiming,
  baseVirality,
  weights,
  precomputedEmbedding
}: {
  text: string;
  judgeScores: [number, number, number];
  topic: string;
  source: string;
  canonicalText: string;
  memoryRetriever?: MemoryRetriever;
  topK?: number;
  baseDemand?: number;
  baseTiming?: number;
  baseVirality?: number;
  weights?: WeightConfig;
  /** Pre-computed embedding — forwarded to findSimilar to skip the per-signal Ollama call */
  precomputedEmbedding?: number[];
}) => {
  const memoryQuery: Parameters<typeof loadMemoryContext>[1] = { topic, source, canonicalText };
  if (topK !== undefined) memoryQuery.topK = topK;
  if (precomputedEmbedding) memoryQuery.embedding = precomputedEmbedding;
  const memoryContext = await loadMemoryContext(memoryRetriever, memoryQuery);

  const scoreInput: ScoreSignalInput = { text, judgeScores, memoryContext };
  if (baseDemand !== undefined) scoreInput.baseDemand = baseDemand;
  if (baseTiming !== undefined) scoreInput.baseTiming = baseTiming;
  if (baseVirality !== undefined) scoreInput.baseVirality = baseVirality;
  if (weights !== undefined) scoreInput.weights = weights;
  return scoreSignal(scoreInput);
};

export const scoreSignalWithAiFallback = async ({
  text,
  source,
  topic,
  judgeScores,
  canonicalText,
  memoryRetriever,
  topK,
  runPrompt,
  weights
}: {
  text: string;
  source: string;
  topic: string;
  judgeScores: [number, number, number];
  canonicalText: string;
  memoryRetriever?: MemoryRetriever;
  topK?: number;
  runPrompt?: (input: { prompt: string; timeoutMs?: number }) => Promise<RunPromptResult>;
  weights?: WeightConfig;
}): Promise<ReturnType<typeof scoreSignal> & { aiScored: boolean; reasoning?: string }> => {
  let aiResult: AiScoreResult | null = null;
  if (runPrompt) {
    aiResult = await aiScoreSignal({ text, source, topic }, { runPrompt });
  }

  const retrieverArgs: Parameters<typeof scoreSignalWithRetriever>[0] = {
    text,
    judgeScores,
    topic,
    source,
    canonicalText
  };
  if (memoryRetriever !== undefined) retrieverArgs.memoryRetriever = memoryRetriever;
  if (topK !== undefined) retrieverArgs.topK = topK;
  if (weights !== undefined) retrieverArgs.weights = weights;
  if (aiResult?.demand !== undefined) retrieverArgs.baseDemand = aiResult.demand;
  if (aiResult?.timing !== undefined) retrieverArgs.baseTiming = aiResult.timing;
  const result = await scoreSignalWithRetriever(retrieverArgs);

  const returnVal: ReturnType<typeof scoreSignal> & { aiScored: boolean; reasoning?: string } = {
    ...result,
    buildability: aiResult?.buildability ?? result.buildability,
    aiScored: aiResult !== null
  };
  if (aiResult?.reasoning !== undefined) returnVal.reasoning = aiResult.reasoning;
  return returnVal;
};
