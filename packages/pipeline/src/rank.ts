export type SignalWithBlend = {
  id: string;
  blended: number;
  demand: number;
  timing: number;
  buildability: number;
  virality: number;
};

export const rankSignals = <T extends SignalWithBlend>(signals: T[]): T[] =>
  [...signals].sort((left, right) => {
    if (right.blended !== left.blended) {
      return right.blended - left.blended;
    }

    return left.id.localeCompare(right.id);
  });
