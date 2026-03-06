export const computeVelocity = (
  weekCount: number,
  avgWeeklyCount: number,
): number => {
  if (avgWeeklyCount <= 0) return 1;
  return Math.round((weekCount / avgWeeklyCount) * 100) / 100;
};

export const velocityMultiplier = (velocity: number): number => {
  const raw = 0.5 + 0.5 * velocity;
  return Math.round(Math.max(0.5, Math.min(2.0, raw)) * 100) / 100;
};
