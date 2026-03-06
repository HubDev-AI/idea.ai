import type { RunPromptInput, RunPromptResult } from '@idea/ai-runtime/src/types';

export type DebateVerdict = 'strong_opportunity' | 'needs_investigation' | 'contested' | 'likely_noise';

export type ModeratorVerdict = {
  confidence: number;
  bull_strength: number;
  bear_strength: number;
  missing_evidence: string[];
  verdict: DebateVerdict;
};

export type DebateResult = {
  bullCase: string;
  bearCase: string;
  verdict: ModeratorVerdict;
  bullProvider: string;
  bearProvider: string;
};

export type DebateInput = {
  thesisTitle: string;
  thesisKey: string;
  problemStatement: string;
  evidence: string[];
  runBull: (input: RunPromptInput) => Promise<RunPromptResult>;
  runBear: (input: RunPromptInput) => Promise<RunPromptResult>;
  runModerator: (input: RunPromptInput) => Promise<RunPromptResult>;
};

export const BULL_SYSTEM = `You are a startup opportunity analyst. Your job is to make the strongest possible case for why this thesis represents a real, buildable SaaS opportunity. Cite specific evidence from the signals provided. Be specific about market size, timing, and competitive advantage. Output a clear, structured argument in 200-400 words.`;

export const BEAR_SYSTEM = `You are a skeptical VC partner. Your job is to find every reason this thesis will FAIL. Consider: Is the market too small? Are incumbents too strong? Is the timing wrong? Is this a hype cycle? Is the pain real or manufactured? Be ruthlessly honest. You must counter the bull case with specific arguments. Output a clear, structured rebuttal in 200-400 words.`;

export const MODERATOR_SYSTEM = `You are a senior investment committee chair. You have received a bull case and a bear case for a startup thesis. Weigh both arguments objectively. Output ONLY a JSON object (no markdown, no explanation) with these fields: confidence (0-1 float), bull_strength (0-100 int), bear_strength (0-100 int), missing_evidence (array of strings, max 3), verdict (one of: "strong_opportunity", "needs_investigation", "likely_noise", "contested").`;

const validVerdicts = new Set<DebateVerdict>([
  'strong_opportunity', 'needs_investigation', 'contested', 'likely_noise',
]);

export const parseModeratorVerdict = (raw: string): ModeratorVerdict | null => {
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.verdict || !validVerdicts.has(parsed.verdict)) return null;
    return {
      confidence: Number(parsed.confidence ?? 0.5),
      bull_strength: Number(parsed.bull_strength ?? 50),
      bear_strength: Number(parsed.bear_strength ?? 50),
      missing_evidence: Array.isArray(parsed.missing_evidence) ? parsed.missing_evidence.slice(0, 5) : [],
      verdict: parsed.verdict,
    };
  } catch {
    return null;
  }
};

const VERDICT_LR: Record<DebateVerdict, number> = {
  strong_opportunity: 2.5,
  needs_investigation: 1.3,
  contested: 0.8,
  likely_noise: 0.3,
};

export const verdictToLikelihoodRatio = (verdict: DebateVerdict): number =>
  VERDICT_LR[verdict] ?? 1.0;

export const runDebate = async (input: DebateInput): Promise<DebateResult | null> => {
  const evidenceBlock = input.evidence.length > 0
    ? `\n\nSupporting evidence:\n${input.evidence.map((e, i) => `${i + 1}. ${e}`).join('\n')}`
    : '';

  const bullResult = await input.runBull({
    prompt: `${BULL_SYSTEM}\n\nThesis: "${input.thesisTitle}"\nProblem: ${input.problemStatement}${evidenceBlock}\n\nMake your bull case:`,
  });

  const bearResult = await input.runBear({
    prompt: `${BEAR_SYSTEM}\n\nThesis: "${input.thesisTitle}"\nProblem: ${input.problemStatement}${evidenceBlock}\n\nBull case to counter:\n${bullResult.text}\n\nMake your bear case:`,
  });

  const modResult = await input.runModerator({
    prompt: `${MODERATOR_SYSTEM}\n\nThesis: "${input.thesisTitle}"\nProblem: ${input.problemStatement}\n\nBull case:\n${bullResult.text}\n\nBear case:\n${bearResult.text}\n\nOutput your JSON verdict:`,
  });

  const verdict = parseModeratorVerdict(modResult.text);
  if (!verdict) return null;

  return {
    bullCase: bullResult.text,
    bearCase: bearResult.text,
    verdict,
    bullProvider: bullResult.provider,
    bearProvider: bearResult.provider,
  };
};
