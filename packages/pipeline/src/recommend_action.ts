export type NextAction = 'validate_demand' | 'validate_pricing' | 'validate_channel';

export const recommendNextAction = ({
  pain,
  timing,
  buildability
}: {
  pain: number;
  timing: number;
  buildability: number;
}): NextAction => {
  if (pain >= 70 && timing >= 65) {
    return 'validate_demand';
  }

  if (pain >= 65 && buildability >= 55) {
    return 'validate_pricing';
  }

  return 'validate_channel';
};
