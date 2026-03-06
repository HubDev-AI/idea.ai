import type { Pool } from 'pg';

type PredictionRow = {
  id: number;
  thesis_key: string;
  predicted_at: string;
  confidence_at_prediction: number;
};

type MatchingSignal = {
  source: string;
  canonical_text: string;
};

export type ValidationDeps = {
  pool: Pool;
  searchRecentSignals: (thesisKey: string) => Promise<MatchingSignal[]>;
  validateAfterDays?: number;
};

const VALIDATION_SOURCES = new Set([
  'producthunt', 'yc_companies', 'github_issues', 'npm_trends', 'crunchbase',
]);

export const validatePredictions = async (
  deps: ValidationDeps
): Promise<{ checked: number; validated: number }> => {
  const afterDays = deps.validateAfterDays ?? 30;
  const cutoff = new Date(Date.now() - afterDays * 24 * 60 * 60 * 1000);

  const { rows: unchecked } = await deps.pool.query<PredictionRow>(
    `SELECT id, thesis_key, predicted_at, confidence_at_prediction
     FROM thesis_predictions
     WHERE outcome_checked_at IS NULL
       AND predicted_at < $1
     ORDER BY predicted_at ASC
     LIMIT 50`,
    [cutoff.toISOString()]
  );

  let checked = 0;
  let validated = 0;

  for (const prediction of unchecked) {
    const signals = await deps.searchRecentSignals(prediction.thesis_key);
    const validationSignals = signals.filter(s => VALIDATION_SOURCES.has(s.source));
    const isValidated = validationSignals.length > 0;

    await deps.pool.query(
      `UPDATE thesis_predictions
       SET outcome_checked_at = NOW(),
           outcome_validated = $1,
           validation_signals = $2
       WHERE id = $3`,
      [isValidated, JSON.stringify(validationSignals.slice(0, 10)), prediction.id]
    );

    checked++;
    if (isValidated) validated++;
  }

  return { checked, validated };
};
