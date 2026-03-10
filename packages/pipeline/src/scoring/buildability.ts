import { clamp } from '../utils';

export const medianOfThree = (scores: [number, number, number] | number[]): number => {
  if (scores.length !== 3) {
    throw new Error('buildability requires exactly 3 judge scores');
  }

  const [a, b, c] = scores.map((score) => clamp(score)).sort((left, right) => left - right);
  return b ?? a ?? c ?? 0;
};

export const scoreBuildability = (judgeScores: [number, number, number] | number[]): number =>
  medianOfThree(judgeScores);
