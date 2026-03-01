export type Scores = {
  demand: number;
  timing: number;
  buildability: number;
  virality: number;
};

export const blendedScore = ({ demand, timing, buildability, virality }: Scores): number =>
  Math.round((0.25 * demand + 0.20 * timing + 0.20 * buildability + 0.35 * virality) * 100) / 100;
