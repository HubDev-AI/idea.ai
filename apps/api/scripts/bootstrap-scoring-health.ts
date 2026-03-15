/**
 * Bootstrap the scoring health data:
 *  1. Snapshot current theses into thesis_predictions (backdated 30 days so validation can run)
 *  2. Validate those predictions against recent signals
 *  3. Populate experience_library for validated ones
 */
import { loadEnvFile } from '../src/config/dotenv';
import { createPostgresSignalStore } from '../src/runtime/postgres_signal_store';
import { createPostgresThesisStore } from '../src/runtime/postgres_thesis_store';
import { createExperienceStore } from '../src/runtime/experience_store';
import { snapshotPredictions } from '../src/jobs/backtest_snapshot';
import { validatePredictions } from '../src/jobs/backtest_validate';
import { embedText } from '@idea/ai-runtime/src/ollama';
import pg from 'pg';

const main = async () => {
  loadEnvFile();
  const databaseUrl = process.env.DATABASE_URL!;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const embedTextFn = (text: string) => embedText(text, { fallbackToNull: true });
  const signalStore = createPostgresSignalStore({ databaseUrl, embedText: embedTextFn });
  const thesisStore = createPostgresThesisStore({ pool });
  const experienceStore = createExperienceStore({ pool });

  // Step 1: snapshot predictions
  console.log('Snapshotting predictions...');
  const snapResult = await snapshotPredictions({ pool, thesisStore, confidenceThreshold: 50 });
  console.log(`Snapshotted: ${snapResult.snapshotted}`);

  // Step 2: backdate them so validatePredictions sees them as old enough
  await pool.query(
    `UPDATE thesis_predictions SET predicted_at = NOW() - INTERVAL '30 days' WHERE outcome_checked_at IS NULL`
  );
  console.log('Backdated predictions 30 days');

  // Step 3: validate with afterDays=0 (all backdated rows qualify)
  console.log('Validating predictions...');
  const valResult = await validatePredictions({
    pool,
    validateAfterDays: 0,
    experienceStore,
    searchRecentSignals: async (_thesisKey: string) => {
      // Load a broad slice of signals and let validatePredictions pick by source
      const signals = await signalStore.listAllSignals(2000);
      return signals.map(s => ({ source: s.source, canonical_text: s.canonical_text }));
    },
    getThesisSummary: async (thesisKey: string) => {
      const thesis = await thesisStore.getByKey(thesisKey);
      if (!thesis) return null;
      return {
        title: thesis.title,
        problemStatement: thesis.problemStatement ?? '',
        evidence: thesis.evidence?.map((e: any) => typeof e === 'string' ? e : (e.snippet ?? '')) ?? [],
        confidence: thesis.confidence,
      };
    },
  });
  console.log(`Validated ${valResult.validated}/${valResult.checked} predictions`);

  // Summary
  const { rows: summary } = await pool.query<{ total: string; validated: string }>(
    `SELECT COUNT(*)::text AS total, COUNT(*) FILTER (WHERE outcome_validated = true)::text AS validated
     FROM thesis_predictions WHERE outcome_checked_at IS NOT NULL`
  );
  const { rows: expRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM experience_library`
  );
  console.log(`\nFinal state:`);
  console.log(`  Predictions checked: ${summary[0]?.total}, validated: ${summary[0]?.validated}`);
  console.log(`  Experience library: ${expRows[0]?.cnt} entries`);

  await pool.end();
  await signalStore.close();
};

main().catch(console.error);
