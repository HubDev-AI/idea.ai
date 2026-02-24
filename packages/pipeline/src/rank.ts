export type SignalWithBlend = {
  id: string;
  blended: number;
  pain: number;
  timing: number;
  buildability: number;
};

export const rankSignals = <T extends SignalWithBlend>(signals: T[]): T[] =>
  [...signals].sort((left, right) => {
    if (right.blended !== left.blended) {
      return right.blended - left.blended;
    }

    return left.id.localeCompare(right.id);
  });
