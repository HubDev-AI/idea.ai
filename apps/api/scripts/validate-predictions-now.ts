/**
 * Validate existing thesis_predictions and populate experience_library.
 * Runs validate in batches until all unchecked are processed.
 */
import { loadEnvFile } from '../src/config/dotenv';
import { createPostgresSignalStore } from '../src/runtime/postgres_signal_store';
import { createPostgresThesisStore } from '../src/runtime/postgres_thesis_store';
import { createExperienceStore } from '../src/runtime/experience_store';
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

  // Pre-load all signals once (avoid repeated DB calls per prediction)
  console.log('Loading signals...');
  const allSignals = await signalStore.listAllSignals(5000);
  console.log(`Loaded ${allSignals.length} signals`);

  let totalChecked = 0;
  let totalValidated = 0;

  // Run in batches of 50 until no more unchecked predictions
  for (let batch = 0; batch < 20; batch++) {
    const result = await validatePredictions({
      pool,
      validateAfterDays: 0,
      experienceStore,
      searchRecentSignals: async () =>
        allSignals.map(s => ({ source: s.source, canonical_text: s.canonical_text })),
      getThesisSummary: async (thesisKey: string) => {
        const thesis = await thesisStore.getByKey(thesisKey);
        if (!thesis) return null;
        return {
          title: thesis.title,
          problemStatement: thesis.problemStatement ?? '',
          evidence: thesis.evidence?.map((e: any) =>
            typeof e === 'string' ? e : (e.snippet ?? '')
          ) ?? [],
          confidence: thesis.confidence,
        };
      },
    });
    totalChecked += result.checked;
    totalValidated += result.validated;
    process.stdout.write(`batch ${batch + 1}: checked=${result.checked} validated=${result.validated}\n`);
    if (result.checked === 0) break;
  }

  const { rows: summary } = await pool.query<{ total: string; validated: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE outcome_validated = true)::text AS validated
     FROM thesis_predictions WHERE outcome_checked_at IS NOT NULL`
  );
  const { rows: expRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM experience_library`
  );

  console.log(`\nDone. Checked: ${totalChecked}, Validated: ${totalValidated}`);
  console.log(`DB: predictions checked=${summary[0]?.total}, validated=${summary[0]?.validated}`);
  console.log(`Experience library: ${expRows[0]?.cnt} entries`);

  await pool.end();
  await signalStore.close();
};

main().catch(console.error);
