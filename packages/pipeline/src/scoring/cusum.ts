export type CusumConfig = {
  threshold: number;
  drift: number;
};

export const DEFAULT_CUSUM_CONFIG: CusumConfig = {
  threshold: 5,
  drift: 1,
};

export const detectChangePoints = (
  values: number[],
  config: CusumConfig = DEFAULT_CUSUM_CONFIG
): number[] => {
  if (values.length < 2) return [];

  const { threshold, drift } = config;
  let posSum = 0;
  let negSum = 0;
  const changePoints: number[] = [];

  for (let i = 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    posSum = Math.max(0, posSum + diff - drift);
    negSum = Math.max(0, negSum - diff - drift);

    if (posSum > threshold || negSum > threshold) {
      changePoints.push(i);
      posSum = 0;
      negSum = 0;
    }
  }

  return changePoints;
};
