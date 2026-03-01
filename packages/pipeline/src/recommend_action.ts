export type NextAction = 'validate_demand' | 'validate_pricing' | 'validate_channel';

export const recommendNextAction = ({
  demand,
  timing,
  buildability
}: {
  demand: number;
  timing: number;
  buildability: number;
}): NextAction => {
  if (demand >= 70 && timing >= 65) {
    return 'validate_demand';
  }

  if (demand >= 65 && buildability >= 55) {
    return 'validate_pricing';
  }

  return 'validate_channel';
};
