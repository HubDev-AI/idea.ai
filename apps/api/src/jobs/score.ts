import { aiScoreSignal, type AiScoreResult } from '@idea/pipeline/src/scoring/ai_score';
import { scorePain } from '@idea/pipeline/src/scoring/pain';
import { scoreTiming } from '@idea/pipeline/src/scoring/timing';
import { scoreBuildability } from '@idea/pipeline/src/scoring/buildability';
import { blendedScore } from '@idea/pipeline/src/scoring/blend';
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

export type ScoreSignalInput = {
  text: string;
  judgeScores: [number, number, number];
  memoryContext?: MemoryContext;
  basePain?: number;
  baseTiming?: number;
};

export const scoreSignal = ({
  text,
  judgeScores,
  memoryContext = emptyMemoryContext,
  basePain,
  baseTiming
}: ScoreSignalInput) => {
  const painCurrent = Number.isFinite(basePain) ? Math.max(0, Math.min(100, Number(basePain))) : scorePain(text);
  const timingCurrent = Number.isFinite(baseTiming)
    ? Math.max(0, Math.min(100, Number(baseTiming)))
    : scoreTiming(text);
  const buildability = scoreBuildability(judgeScores);
  const distances = memoryContext.similar.map((entry) => entry.distance);
  const novelty = noveltyScoreFromDistances(distances);
  const saturation = saturationScoreFromDistances(distances);
  const persistence = persistenceScoreFromWindows(memoryContext.windows);
  const momentum = momentumScoreFromWindows(memoryContext.windows);
  const pain = applyPainMemory(painCurrent, persistence);
  const timing = applyTimingMemory(timingCurrent, momentum, novelty, saturation);

  return {
    pain,
    timing,
    buildability,
    blended: blendedScore({ pain, timing, buildability }),
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
  basePain,
  baseTiming
}: {
  text: string;
  judgeScores: [number, number, number];
  topic: string;
  source: string;
  canonicalText: string;
  memoryRetriever?: MemoryRetriever;
  topK?: number;
  basePain?: number;
  baseTiming?: number;
}) => {
  const memoryContext = await loadMemoryContext(memoryRetriever, {
    topic,
    source,
    canonicalText,
    topK
  });

  return scoreSignal({
    text,
    judgeScores,
    memoryContext,
    basePain,
    baseTiming
  });
};

export const scoreSignalWithAiFallback = async ({
  text,
  source,
  topic,
  judgeScores,
  canonicalText,
  memoryRetriever,
  topK,
  runPrompt
}: {
  text: string;
  source: string;
  topic: string;
  judgeScores: [number, number, number];
  canonicalText: string;
  memoryRetriever?: MemoryRetriever;
  topK?: number;
  runPrompt?: (input: { prompt: string; timeoutMs?: number }) => Promise<{ text: string }>;
}): Promise<ReturnType<typeof scoreSignal> & { aiScored: boolean; reasoning?: string }> => {
  let aiResult: AiScoreResult | null = null;
  if (runPrompt) {
    aiResult = await aiScoreSignal({ text, source, topic }, { runPrompt });
  }

  const result = await scoreSignalWithRetriever({
    text,
    judgeScores,
    topic,
    source,
    canonicalText,
    memoryRetriever,
    topK,
    basePain: aiResult?.pain,
    baseTiming: aiResult?.timing
  });

  return {
    ...result,
    buildability: aiResult?.buildability ?? result.buildability,
    aiScored: aiResult !== null,
    reasoning: aiResult?.reasoning
  };
};
