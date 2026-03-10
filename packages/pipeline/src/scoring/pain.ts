import { clamp } from '../utils';

const PAIN_KEYWORDS = ['urgent', 'pain', 'manual', 'costly', 'churn', 'friction', 'broken'];

export const scorePain = (text: string): number => {
  const normalized = text.toLowerCase();
  const hits = PAIN_KEYWORDS.filter((keyword) => normalized.includes(keyword)).length;

  return clamp(20 + hits * 12);
};
