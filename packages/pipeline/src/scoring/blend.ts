export type Scores = {
  pain: number;
  timing: number;
  buildability: number;
};

export const blendedScore = ({ pain, timing, buildability }: Scores): number =>
  Math.round((0.4 * pain + 0.4 * timing + 0.2 * buildability) * 100) / 100;
