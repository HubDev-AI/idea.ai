const TIMING_KEYWORDS = ['now', 'deadline', 'regulation', 'launch', 'trend', 'market', 'shift'];

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

export const scoreTiming = (text: string): number => {
  const normalized = text.toLowerCase();
  const hits = TIMING_KEYWORDS.filter((keyword) => normalized.includes(keyword)).length;

  return clamp(15 + hits * 13);
};
