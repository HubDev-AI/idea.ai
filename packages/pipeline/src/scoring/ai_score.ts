import type { RunPromptResult } from '@idea/ai-runtime/src/types';

export type AiScoreResult = {
  pain: number;
  timing: number;
  buildability: number;
  reasoning: string;
};

const clamp = (v: number) => Math.min(100, Math.max(0, v));

const SCORE_PROMPT = `You are a SaaS opportunity analyst. Score this signal on three dimensions (0-100 each):

- **pain** (0-100): How severe and recurring is the problem described? 0 = no real pain, 100 = urgent unresolved pain affecting many people.
- **timing** (0-100): How timely is this opportunity? 0 = stale/already solved, 100 = emerging right now with regulatory or market tailwinds.
- **buildability** (0-100): How feasible is it to build a SaaS product addressing this? 0 = requires deep domain expertise or massive capital, 100 = straightforward to build and sell.

Also provide a one-sentence reasoning for your scores.

Return ONLY valid JSON: {"pain": <n>, "timing": <n>, "buildability": <n>, "reasoning": "<text>"}

SIGNAL:
Source: {source}
Topic: {topic}
Text: {text}
`;

export const parseAiScoreResponse = (raw: string): AiScoreResult | null => {
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.pain !== 'number' ||
      typeof parsed.timing !== 'number' ||
      typeof parsed.buildability !== 'number'
    ) {
      return null;
    }
    return {
      pain: clamp(Math.round(parsed.pain)),
      timing: clamp(Math.round(parsed.timing)),
      buildability: clamp(Math.round(parsed.buildability)),
      reasoning: String(parsed.reasoning ?? '')
    };
  } catch {
    return null;
  }
};

export const aiScoreSignal = async (
  signal: { text: string; source: string; topic: string },
  deps: { runPrompt: (input: { prompt: string; timeoutMs?: number }) => Promise<RunPromptResult> }
): Promise<AiScoreResult | null> => {
  try {
    const prompt = SCORE_PROMPT
      .replace('{source}', signal.source)
      .replace('{topic}', signal.topic)
      .replace('{text}', signal.text.slice(0, 1500));

    const result = await deps.runPrompt({ prompt, timeoutMs: 25_000 });
    return parseAiScoreResponse(result.text);
  } catch {
    return null;
  }
};
