import { velocityMultiplier } from './velocity';

export type Scores = {
  demand: number;
  timing: number;
  buildability: number;
  virality: number;
};

export const blendedScore = ({ demand, timing, buildability, virality }: Scores): number =>
  Math.round((0.25 * demand + 0.20 * timing + 0.20 * buildability + 0.35 * virality) * 100) / 100;

export const blendedScoreWithVelocity = (scores: Scores, velocity: number): number => {
  const base = blendedScore(scores);
  const multiplier = velocityMultiplier(velocity);
  return Math.round(base * multiplier * 100) / 100;
};
