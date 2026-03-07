export type SupplyInput = {
  existingProducts: number;
  githubRepos: number;
  fundedCompanies: number;
};

export type SupplyEstimate = {
  totalSupply: number;
  maturityLevel: 'nascent' | 'growing' | 'mature' | 'saturated';
};

export type ImbalanceClass = 'opportunity' | 'competitive' | 'niche' | 'saturated';

export const estimateSupply = (input: SupplyInput): SupplyEstimate => {
  const total = input.existingProducts + input.githubRepos + input.fundedCompanies;

  let maturityLevel: SupplyEstimate['maturityLevel'];
  if (total === 0) maturityLevel = 'nascent';
  else if (total <= 15) maturityLevel = 'growing';
  else if (total <= 50) maturityLevel = 'mature';
  else maturityLevel = 'saturated';

  return { totalSupply: total, maturityLevel };
};

export const classifyImbalance = (input: {
  demandSignals: number;
  totalSupply: number;
}): ImbalanceClass => {
  const { demandSignals, totalSupply } = input;
  const highDemand = demandSignals >= 10;
  const highSupply = totalSupply >= 15;

  if (highDemand && !highSupply) return 'opportunity';
  if (highDemand && highSupply) return 'competitive';
  if (!highDemand && !highSupply) return 'niche';
  return 'saturated';
};

export const imbalanceMultiplier = (classification: ImbalanceClass): number => {
  const multipliers: Record<ImbalanceClass, number> = {
    opportunity: 1.5,
    competitive: 1.0,
    niche: 0.7,
    saturated: 0.4,
  };
  return multipliers[classification];
};
