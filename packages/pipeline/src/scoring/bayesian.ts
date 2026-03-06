export type SignalEvidenceType =
  | 'multi_source_convergence'
  | 'single_high_quality'
  | 'github_repo_growth'
  | 'stackoverflow_spike'
  | 'enterprise_adoption'
  | 'weak_noisy';

export type SignalEvidence = {
  type: SignalEvidenceType;
  confirming: boolean;
  sourceCount: number;
};

export type BayesianConfig = {
  defaultPrior: number;
  decayRate: number;
  decayAfterDays: number;
  floorConfidence: number;
};

export const DEFAULT_BAYESIAN_CONFIG: BayesianConfig = {
  defaultPrior: 20,
  decayRate: 0.97,
  decayAfterDays: 14,
  floorConfidence: 5,
};

const LIKELIHOOD_RATIOS: Record<SignalEvidenceType, { confirming: number; contradicting: number }> = {
  multi_source_convergence: { confirming: 2.2, contradicting: 0.4 },
  single_high_quality:      { confirming: 1.6, contradicting: 0.6 },
  github_repo_growth:       { confirming: 1.7, contradicting: 0.7 },
  stackoverflow_spike:      { confirming: 1.6, contradicting: 0.8 },
  enterprise_adoption:      { confirming: 2.2, contradicting: 0.5 },
  weak_noisy:               { confirming: 1.1, contradicting: 0.9 },
};

const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

export const bayesianUpdate = (
  priorConfidence: number,
  evidence: SignalEvidence,
  _config: BayesianConfig = DEFAULT_BAYESIAN_CONFIG,
): number => {
  const prior = clamp(priorConfidence, 0, 100) / 100;
  const ratios = LIKELIHOOD_RATIOS[evidence.type] ?? LIKELIHOOD_RATIOS.weak_noisy;
  const lr = evidence.confirming ? ratios.confirming : ratios.contradicting;
  const numerator = prior * lr;
  const denominator = numerator + (1 - prior);
  const posterior = denominator > 0 ? numerator / denominator : prior;
  return clamp(Math.round(posterior * 10000) / 100, 0, 100);
};

export const computeDecay = (
  confidence: number,
  daysSinceLastSignal: number,
  config: BayesianConfig = DEFAULT_BAYESIAN_CONFIG,
): number => {
  if (daysSinceLastSignal <= config.decayAfterDays) return confidence;
  const decayDays = daysSinceLastSignal - config.decayAfterDays;
  const decayed = confidence * Math.pow(config.decayRate, decayDays);
  return Math.max(Math.round(decayed * 100) / 100, config.floorConfidence);
};
