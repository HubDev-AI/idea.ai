const PAIN_KEYWORDS = ['urgent', 'pain', 'manual', 'costly', 'churn', 'friction', 'broken'];

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

export const scorePain = (text: string): number => {
  const normalized = text.toLowerCase();
  const hits = PAIN_KEYWORDS.filter((keyword) => normalized.includes(keyword)).length;

  return clamp(20 + hits * 12);
};
