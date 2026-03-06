import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Cadence, OPEN_CONNECTOR_CADENCE, type RawEventInput } from '@idea/connectors/src/common/http';
import { blendedScore } from '@idea/pipeline/src/scoring/blend';
import type { RuntimeEnv } from '../config/env';
import { loadRuntimeEnv } from '../config/env';
import {
  type AiJudgeAttempt,
  type AiJudgeSettings, 
  isAiJudgeEligible,
  judgeBuildabilityWithAi,
  resolveAiJudgeSettings
} from '../jobs/ai_judges';
import {
  type AiPostScrapeAttempt,
  type AiPostScrapeSettings, 
  analyzePostScrapeBatchWithAi,
  resolveAiPostScrapeSettings
} from '../jobs/ai_post_scrape';
import { runByoConnectorIngestion } from '../jobs/ingest_byo';
import {
  type OpenConnectorIngestionResult,
  type OpenConnectorName, 
  runOpenConnectorIngestionDetailed
} from '../jobs/ingest_open';
import { indexSignalMemory } from '../jobs/memory_index';
import { buildRetrieverQueryText, createInMemoryRetriever, type IndexedMemoryEntry } from '../jobs/memory_retriever';
import { rankAndPreparePublish } from '../jobs/rank_publish';
import { scoreSignalWithRetriever } from '../jobs/score';
import type { AiHealthRecord, AiProviderHealthRecord } from '../routes/ai_health';
import type { ConnectorStatusRecord } from '../routes/connectors';
import type { FeedRecord } from '../routes/feed';
import type { ExecutionLogRecord, ListLogsQuery } from '../routes/logs';
import { readExecutionLogs } from './execution_log_reader';
import { createExecutionLogger, createRunId } from './execution_logger';
import { createPostgresMemoryStore, type PostgresMemoryStore } from './postgres_memory_store';
import type { ProviderCircuitBreaker } from './provider_circuit';
import {
  applySourceQualityPenalty,
  findIdeaCandidates,
  isLowValueOpportunityTitle,
  isLowValueRecruitingEvent,
  selectEventsForScoring
} from './signal_quality';

const DEFAULT_REFRESH_MS = 60 * 60 * 1000;
const DEFAULT_SNAPSHOT_FILE = (): string => join(process.cwd(), 'logs', 'state', 'latest_snapshot.json');
const OPEN_CONNECTORS: OpenConnectorName[] = ['hn', 'github_issues', 'greenhouse', 'lever', 'yc_companies', 'reddit', 'producthunt', 'appstore_trending', 'indiehackers', 'lobsters', 'devto', 'showhn', 'mastodon', 'bluesky', 'homebrew', 'google_trends', 'tiktok_creative', 'alternativeto', 'stackoverflow', 'g2_reviews', 'npm_trends', 'semantic_scholar'];

type Snapshot = {
  refreshedAt: number;
  signals: FeedRecord[];
  connectors: ConnectorStatusRecord[];
  lastHourlyRunAt: number;
  lastDailyRunAt: number;
};

const resolveProviderSetting = (env: NodeJS.ProcessEnv): 'claude' | 'codex' | 'both' => {
  const providerRaw = env.AI_PROVIDER?.toLowerCase();
  if (providerRaw === 'codex') {
    return 'codex';
  }

  if (providerRaw === 'both') {
    return 'both';
  }

  return 'claude';
};

const isProviderEnabled = (providerSetting: 'claude' | 'codex' | 'both', provider: 'claude' | 'codex'): boolean => {
  if (providerSetting === 'both') {
    return true;
  }

  return providerSetting === provider;
};

const toAiProviderStatus = (provider: AiProviderHealthRecord): AiProviderHealthRecord['status'] => {
  if (!provider.enabled) {
    return 'disabled';
  }

  if (provider.attempted === 0) {
    return 'idle';
  }

  if (provider.failed === 0 && provider.succeeded > 0) {
    return 'healthy';
  }

  if (provider.succeeded > 0 && provider.failed > 0) {
    return 'degraded';
  }

  return 'error';
};

const createAiHealthSnapshot = ({
  env,
  runId,
  refreshedAt,
  aiJudgeSettings,
  aiPostScrapeSettings
}: {
  env: NodeJS.ProcessEnv;
  runId: string | null;
  refreshedAt: string | null;
  aiJudgeSettings: Pick<AiJudgeSettings, 'mode' | 'allowFallback' | 'retries' | 'maxSignals' | 'preferredProvider'>;
  aiPostScrapeSettings: Pick<AiPostScrapeSettings, 'enabled' | 'maxSignals'>;
}): AiHealthRecord => {
  const providerSetting = resolveProviderSetting(env);
  const providers: AiProviderHealthRecord[] = (['claude', 'codex'] as const).map((provider) => ({
    provider,
    enabled: isProviderEnabled(providerSetting, provider),
    status: isProviderEnabled(providerSetting, provider) ? 'idle' : 'disabled',
    attempted: 0,
    succeeded: 0,
    failed: 0,
    retries: 0,
    last_error: null
  }));

  return {
    run_id: runId,
    refreshed_at: refreshedAt,
    provider_setting: providerSetting,
    primary_provider: aiJudgeSettings.preferredProvider,
    judge_mode: aiJudgeSettings.mode,
    fallback_enabled: aiJudgeSettings.allowFallback,
    retry_budget: aiJudgeSettings.retries,
    post_scrape_enabled: aiPostScrapeSettings.enabled,
    post_scrape_max_signals: aiPostScrapeSettings.maxSignals,
    judge_max_signals: aiJudgeSettings.maxSignals,
    providers
  };
};

const applyAiAttempts = (
  health: AiHealthRecord,
  attempts: Array<AiJudgeAttempt | AiPostScrapeAttempt>
): AiHealthRecord => {
  const byProvider = new Map(health.providers.map((provider) => [provider.provider, { ...provider }]));

  for (const attempt of attempts) {
    const record = byProvider.get(attempt.provider);
    if (!record) {
      continue;
    }

    record.attempted += 1;
    if (attempt.success) {
      record.succeeded += 1;
    } else {
      record.failed += 1;
      record.last_error = attempt.error ?? record.last_error;
    }

    if (attempt.attempt > 1) {
      record.retries += 1;
    }
  }

  const providers = (['claude', 'codex'] as const).map((provider) => {
    const record = byProvider.get(provider);
    if (!record) {
      return {
        provider,
        enabled: false,
        status: 'disabled',
        attempted: 0,
        succeeded: 0,
        failed: 0,
        retries: 0,
        last_error: null
      } satisfies AiProviderHealthRecord;
    }

    return {
      ...record,
      status: toAiProviderStatus(record)
    } satisfies AiProviderHealthRecord;
  });

  return {
    ...health,
    providers
  };
};

const pickTopic = (text: string): string => {
  const normalized = text.toLowerCase();

  if (normalized.includes('compliance') || normalized.includes('soc2') || normalized.includes('audit')) {
    return 'compliance';
  }

  if (normalized.includes('billing') || normalized.includes('payment') || normalized.includes('invoice')) {
    return 'billing';
  }

  if (normalized.includes('support') || normalized.includes('ticket') || normalized.includes('customer success')) {
    return 'support';
  }

  if (normalized.includes('ai') || normalized.includes('llm') || normalized.includes('agent')) {
    return 'ai_tooling';
  }

  return 'general';
};

const toIdea = (event: RawEventInput): string => {
  const firstLine = event.text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return `${event.source} opportunity`;
  }

  return firstLine.length > 90 ? `${firstLine.slice(0, 87)}...` : firstLine;
};

const dedupeEvents = (events: RawEventInput[]): RawEventInput[] => {
  const byKey = new Map<string, RawEventInput>();

  for (const event of events) {
    byKey.set(`${event.source}:${event.source_item_id}`, event);
  }

  return Array.from(byKey.values());
};

const countBySource = (events: RawEventInput[]): Record<string, number> =>
  events.reduce<Record<string, number>>((acc, event) => {
    acc[event.source] = (acc[event.source] ?? 0) + 1;
    return acc;
  }, {});

const isConnectorSelected = (connector: OpenConnectorName, env: RuntimeEnv): boolean => {
  if (OPEN_CONNECTOR_CADENCE[connector] === 'hourly') {
    return env.hourlyConnectors.includes(connector);
  }

  return env.dailyConnectors.includes(connector);
};

const isConnectorConfigured = (connector: OpenConnectorName, env: RuntimeEnv): boolean => {
  if (connector === 'greenhouse') {
    return env.enableJobConnectors && Boolean(env.greenhouseBoardToken);
  }

  if (connector === 'lever') {
    return env.enableJobConnectors && Boolean(env.leverSite);
  }

  return true;
};

const enabledOpenConnectors = (cadence: Cadence, env: RuntimeEnv): OpenConnectorName[] =>
  OPEN_CONNECTORS.filter((connector) => {
    if (OPEN_CONNECTOR_CADENCE[connector] !== cadence) {
      return false;
    }

    return isConnectorSelected(connector, env) && isConnectorConfigured(connector, env);
  });

const openStatusMap = (
  hourly: OpenConnectorIngestionResult,
  daily: OpenConnectorIngestionResult
): Map<OpenConnectorName, 'active' | 'error'> => {
  const map = new Map<OpenConnectorName, 'active' | 'error'>();

  for (const status of [...hourly.statuses, ...daily.statuses]) {
    map.set(status.name, status.status);
  }

  return map;
};

const mapByoStatus = (
  status: 'active' | 'skipped' | 'error',
  refreshedAtIso: string
): Pick<ConnectorStatusRecord, 'status' | 'last_run'> => {
  if (status === 'active') {
    return { status: 'active', last_run: refreshedAtIso };
  }

  if (status === 'error') {
    return { status: 'error', last_run: refreshedAtIso };
  }

  return { status: 'disabled', last_run: null };
};

const toConnectorStatus = (
  env: RuntimeEnv,
  hourly: OpenConnectorIngestionResult,
  daily: OpenConnectorIngestionResult,
  byo: Awaited<ReturnType<typeof runByoConnectorIngestion>>,
  refreshedAtIso: string,
  lastDailyRunAt: number
): ConnectorStatusRecord[] => {
  const openStatuses = openStatusMap(hourly, daily);
  const dailyLastRunIso = lastDailyRunAt > 0 ? new Date(lastDailyRunAt).toISOString() : null;
  const openRecords: ConnectorStatusRecord[] = OPEN_CONNECTORS.map((connector) => {
    const cadence = (OPEN_CONNECTOR_CADENCE[connector] as Cadence) ?? null;
    if (!isConnectorSelected(connector, env) || !isConnectorConfigured(connector, env)) {
      return {
        name: connector,
        status: 'disabled',
        last_run: null,
        cadence
      };
    }

    const lastRun = cadence === 'daily' ? (dailyLastRunIso ?? refreshedAtIso) : refreshedAtIso;

    return {
      name: connector,
      status: openStatuses.get(connector) === 'error' ? 'error' : 'active',
      last_run: lastRun,
      cadence
    };
  });

  const exa = mapByoStatus(byo.connectors.exa.status, refreshedAtIso);
  const perigon = mapByoStatus(byo.connectors.perigon.status, refreshedAtIso);
  const twitter = mapByoStatus(byo.connectors.twitter.status, refreshedAtIso);

  return [
    ...openRecords,
    { name: 'exa_byo', status: exa.status, last_run: exa.last_run, cadence: 'daily' as const },
    { name: 'perigon_byo', status: perigon.status, last_run: perigon.last_run, cadence: 'daily' as const },
    { name: 'twitter_byo', status: twitter.status, last_run: twitter.last_run, cadence: 'daily' as const }
  ];
};

const toErrorFirstSnapshot = (env: RuntimeEnv, refreshedAtIso: string): ConnectorStatusRecord[] => [
  ...OPEN_CONNECTORS.map((connector): ConnectorStatusRecord => {
    const cadence = (OPEN_CONNECTOR_CADENCE[connector] as Cadence) ?? null;
    if (!isConnectorSelected(connector, env) || !isConnectorConfigured(connector, env)) {
      return {
        name: connector,
        status: 'disabled',
        last_run: null,
        cadence
      };
    }

    return {
      name: connector,
      status: 'error',
      last_run: refreshedAtIso,
      cadence
    };
  }),
  {
    name: 'exa_byo',
    status: (env.exaApiKey && env.exaDailyBudgetUsd > 0 ? 'error' : 'disabled') as ConnectorStatusRecord['status'],
    last_run: env.exaApiKey && env.exaDailyBudgetUsd > 0 ? refreshedAtIso : null,
    cadence: 'daily'
  },
  {
    name: 'perigon_byo',
    status: (env.perigonApiKey && env.perigonDailyBudgetUsd > 0 ? 'error' : 'disabled') as ConnectorStatusRecord['status'],
    last_run: env.perigonApiKey && env.perigonDailyBudgetUsd > 0 ? refreshedAtIso : null,
    cadence: 'daily'
  },
  {
    name: 'twitter_byo',
    status: (env.xBearerToken && env.xDailyBudgetUsd > 0 ? 'error' : 'disabled') as ConnectorStatusRecord['status'],
    last_run: env.xBearerToken && env.xDailyBudgetUsd > 0 ? refreshedAtIso : null,
    cadence: 'daily'
  }
];

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : 'Unknown error');

const resolveSnapshotFile = (env: NodeJS.ProcessEnv): string | null => {
  if (!env.SNAPSHOT_FILE && (env.NODE_ENV === 'test' || env.VITEST === 'true')) {
    return null;
  }

  return env.SNAPSHOT_FILE ?? DEFAULT_SNAPSHOT_FILE();
};

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseSnapshotPayload = (raw: string): Snapshot | null => {
  try {
    const parsed = JSON.parse(raw) as Partial<Snapshot> & {
      refreshedAt?: unknown;
      signals?: unknown;
      connectors?: unknown;
    };

    if (!parsed || !Array.isArray(parsed.signals) || !Array.isArray(parsed.connectors)) {
      return null;
    }

    const signals: FeedRecord[] = parsed.signals
      .map((entry) => {
        if (!isObject(entry)) {
          return null;
        }

        if (
          typeof entry.idea !== 'string' ||
          typeof entry.score !== 'number' ||
          typeof entry.top_source !== 'string' ||
          typeof entry.snippet !== 'string' ||
          (entry.source_url !== null && typeof entry.source_url !== 'string') ||
          (entry.next_action !== 'validate_demand' &&
            entry.next_action !== 'validate_pricing' &&
            entry.next_action !== 'validate_channel') ||
          typeof entry.updated_at !== 'string'
        ) {
          return null;
        }

        return {
          idea: entry.idea,
          score: entry.score,
          top_source: entry.top_source,
          snippet: entry.snippet,
          source_url: entry.source_url,
          next_action: entry.next_action,
          updated_at: entry.updated_at,
          ...(typeof entry.demand === 'number' ? { demand: entry.demand } : {}),
          ...(typeof entry.timing === 'number' ? { timing: entry.timing } : {}),
          ...(typeof entry.buildability === 'number' ? { buildability: entry.buildability } : {}),
          ...(typeof entry.virality === 'number' ? { virality: entry.virality } : {})
        } satisfies FeedRecord;
      })
      .filter((entry): entry is FeedRecord => entry !== null);

    const connectors: ConnectorStatusRecord[] = parsed.connectors
      .map((entry) => {
        if (!isObject(entry)) {
          return null;
        }

        if (
          typeof entry.name !== 'string' ||
          (entry.status !== 'active' && entry.status !== 'disabled' && entry.status !== 'error') ||
          (entry.last_run !== null && typeof entry.last_run !== 'string')
        ) {
          return null;
        }

        const cadence = entry.cadence === 'hourly' || entry.cadence === 'daily' ? entry.cadence : null;
        return {
          name: entry.name,
          status: entry.status,
          last_run: entry.last_run,
          cadence
        } satisfies ConnectorStatusRecord;
      })
      .filter((entry): entry is ConnectorStatusRecord => entry !== null);

    return {
      refreshedAt: toNumber(parsed.refreshedAt, 0),
      signals,
      connectors,
      lastHourlyRunAt: toNumber(parsed.lastHourlyRunAt, 0),
      lastDailyRunAt: toNumber(parsed.lastDailyRunAt, 0)
    };
  } catch {
    return null;
  }
};

const buildInitialConnectors = (env: RuntimeEnv): ConnectorStatusRecord[] => {
  const openRecords: ConnectorStatusRecord[] = OPEN_CONNECTORS.map((connector) => {
    const cadence = (OPEN_CONNECTOR_CADENCE[connector] as Cadence) ?? null;
    if (!isConnectorSelected(connector, env) || !isConnectorConfigured(connector, env)) {
      return { name: connector, status: 'disabled' as const, last_run: null, cadence };
    }
    return { name: connector, status: 'active' as const, last_run: null, cadence };
  });

  return [
    ...openRecords,
    { name: 'exa_byo', status: (env.exaApiKey && env.exaDailyBudgetUsd > 0 ? 'active' : 'disabled') as ConnectorStatusRecord['status'], last_run: null, cadence: 'daily' as const },
    { name: 'perigon_byo', status: (env.perigonApiKey && env.perigonDailyBudgetUsd > 0 ? 'active' : 'disabled') as ConnectorStatusRecord['status'], last_run: null, cadence: 'daily' as const },
    { name: 'twitter_byo', status: (env.xBearerToken && env.xDailyBudgetUsd > 0 ? 'active' : 'disabled') as ConnectorStatusRecord['status'], last_run: null, cadence: 'daily' as const }
  ];
};

export const createLiveReadModel = (refreshMs = DEFAULT_REFRESH_MS, opts?: { persistentStore?: PostgresMemoryStore; circuit?: ProviderCircuitBreaker }) => {
  const startedAt = Date.now();
  const initialEnv = loadRuntimeEnv(process.env);
  const initialAiJudgeSettings = resolveAiJudgeSettings(process.env);
  const initialAiPostScrapeSettings = resolveAiPostScrapeSettings(process.env);
  const circuit = opts?.circuit;
  const memoryEntries: IndexedMemoryEntry[] = [];
  let postgresMemoryStore: PostgresMemoryStore | null | undefined = opts?.persistentStore ?? undefined;
  let snapshotHydrated = false;
  let refreshInFlight: Promise<Snapshot> | null = null;
  let refreshingCadence: 'hourly' | 'daily' | null = null;
  const sessionRunIds = new Set<string>();
  let aiHealth: AiHealthRecord = createAiHealthSnapshot({
    env: process.env,
    runId: null,
    refreshedAt: null,
    aiJudgeSettings: initialAiJudgeSettings,
    aiPostScrapeSettings: initialAiPostScrapeSettings
  });
  let snapshot: Snapshot = {
    refreshedAt: 0,
    signals: [],
    connectors: buildInitialConnectors(initialEnv),
    lastHourlyRunAt: 0,
    lastDailyRunAt: 0
  };

  const hydrateSnapshotFromDisk = async (
    env: NodeJS.ProcessEnv,
    logger: ReturnType<typeof createExecutionLogger>
  ): Promise<void> => {
    if (snapshotHydrated) {
      return;
    }

    snapshotHydrated = true;
    const snapshotFile = resolveSnapshotFile(env);
    if (!snapshotFile) {
      return;
    }

    try {
      const raw = await readFile(snapshotFile, 'utf8');
      const parsed = parseSnapshotPayload(raw);

      if (!parsed) {
        await logger.warn('live_read_model', 'snapshot file is invalid, ignoring persisted snapshot', {
          snapshot_file: snapshotFile
        });
        return;
      }

      // Reset last_run so connectors show as pending until they actually refresh in this session
      parsed.connectors = parsed.connectors.map((c) => ({ ...c, last_run: null }));
      snapshot = parsed;
      await logger.info('live_read_model', 'loaded persisted snapshot', {
        snapshot_file: snapshotFile,
        refreshed_at: snapshot.refreshedAt > 0 ? new Date(snapshot.refreshedAt).toISOString() : null,
        signals: snapshot.signals.length,
        connectors: snapshot.connectors.length
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await logger.warn('live_read_model', 'failed to load persisted snapshot', {
          snapshot_file: snapshotFile,
          error: toErrorMessage(error)
        });
      }
    }
  };

  const persistSnapshotToDisk = async (
    env: NodeJS.ProcessEnv,
    logger: ReturnType<typeof createExecutionLogger>,
    nextSnapshot: Snapshot
  ): Promise<void> => {
    const snapshotFile = resolveSnapshotFile(env);
    if (!snapshotFile) {
      return;
    }

    try {
      await mkdir(dirname(snapshotFile), { recursive: true });
      await writeFile(snapshotFile, JSON.stringify(nextSnapshot), 'utf8');
    } catch (error) {
      await logger.warn('live_read_model', 'failed to persist snapshot', {
        snapshot_file: snapshotFile,
        error: toErrorMessage(error)
      });
    }
  };

  const resolvePostgresMemoryStore = async (
    env: RuntimeEnv,
    logger: ReturnType<typeof createExecutionLogger>
  ): Promise<PostgresMemoryStore | null> => {
    if (postgresMemoryStore !== undefined) {
      return postgresMemoryStore;
    }

    if (!env.databaseUrl) {
      postgresMemoryStore = null;
      await logger.warn('live_read_model', 'DATABASE_URL not set, using in-memory memory store');
      return postgresMemoryStore;
    }

    try {
      const store = createPostgresMemoryStore({
        databaseUrl: env.databaseUrl,
        logger
      });
      await store.ping();
      postgresMemoryStore = store;

      await logger.info('live_read_model', 'postgres memory store enabled');
      return postgresMemoryStore;
    } catch (error) {
      postgresMemoryStore = null;
      await logger.error('live_read_model', 'postgres memory store unavailable', {
        error: toErrorMessage(error)
      });
      return postgresMemoryStore;
    }
  };

  const refresh = async (forceCadence?: 'hourly' | 'daily'): Promise<Snapshot> => {
    const env = loadRuntimeEnv(process.env);
    const runId = process.env.RUN_ID ?? createRunId('read_model');
    const logger = createExecutionLogger({ env: process.env, runId });
    sessionRunIds.add(logger.runId);
    const aiJudgeSettings = resolveAiJudgeSettings(process.env);
    const aiPostScrapeSettings = resolveAiPostScrapeSettings(process.env);
    let runAiHealth = createAiHealthSnapshot({
      env: process.env,
      runId: logger.runId,
      refreshedAt: null,
      aiJudgeSettings,
      aiPostScrapeSettings
    });

    await hydrateSnapshotFromDisk(process.env, logger);

    const persistentStore = await resolvePostgresMemoryStore(env, logger);
    const DAILY_CADENCE_MS = 24 * 60 * 60 * 1000;
    const dailyDue = forceCadence === 'daily' || (!forceCadence && Date.now() - snapshot.lastDailyRunAt >= DAILY_CADENCE_MS);
    refreshingCadence = dailyDue ? 'daily' : 'hourly';
    const cadenceLabel = dailyDue ? 'daily_refresh' : 'hourly_refresh';

    await logger.info(cadenceLabel, `=== ${dailyDue ? 'DAILY' : 'HOURLY'} REFRESH START ===`, {
      run_id: logger.runId
    });

    try {
      const refreshStartedAt = Date.now();

      const skipHourly = forceCadence === 'daily';
      const emptyIngestion = { events: [] as RawEventInput[], statuses: [] as OpenConnectorIngestionResult['statuses'] } as OpenConnectorIngestionResult;

      const [hourly, daily, byo] = await Promise.all([
        skipHourly
          ? Promise.resolve(emptyIngestion)
          : runOpenConnectorIngestionDetailed('hourly', {
              enabledConnectors: enabledOpenConnectors('hourly', env),
              logger
            }),
        dailyDue
          ? runOpenConnectorIngestionDetailed('daily', {
              enabledConnectors: enabledOpenConnectors('daily', env),
              logger
            })
          : Promise.resolve(emptyIngestion),
        forceCadence
          ? Promise.resolve({ connectors: { exa: { status: 'skipped' as const, events: [] }, perigon: { status: 'skipped' as const, events: [] }, twitter: { status: 'skipped' as const, events: [] } } })
          : runByoConnectorIngestion(process.env, { logger })
      ]);

      const events = dedupeEvents([...hourly.events, ...daily.events, ...byo.connectors.exa.events, ...byo.connectors.perigon.events, ...byo.connectors.twitter.events]);
      const highSignalEvents = events.filter((event) => !isLowValueRecruitingEvent(event));
      const selectedEvents = selectEventsForScoring(highSignalEvents);

      await logger.info(cadenceLabel, 'event selection prepared', {
        total_events: events.length,
        filtered_events: highSignalEvents.length,
        filtered_recruiting_noise: events.length - highSignalEvents.length,
        selected_events: selectedEvents.length,
        selected_by_source: countBySource(selectedEvents)
      });

      const selectedSignalInputs = selectedEvents.map((event) => {
        const signalId = `${event.source}:${event.source_item_id}`;
        const topic = pickTopic(event.text);
        const ideaDraft = toIdea(event);

        return {
          event,
          signalId,
          topic,
          ideaDraft
        };
      });

      const aiPostScrapeBatch = await analyzePostScrapeBatchWithAi({
        settings: aiPostScrapeSettings,
        logger,
        circuit,
        inputs: selectedSignalInputs.map((entry) => ({
          id: entry.signalId,
          source: entry.event.source,
          topic: entry.topic,
          ideaDraft: entry.ideaDraft,
          text: entry.event.text
        }))
      });
      runAiHealth = applyAiAttempts(runAiHealth, aiPostScrapeBatch.attempts);
      aiHealth = runAiHealth;
      const aiPostScrapeInsights = aiPostScrapeBatch.insights;

      const scoredSignals: Array<{
        id: string;
        idea: string;
        top_source: string;
        snippet: string;
        source_url: string | null;
        demand: number;
        timing: number;
        buildability: number;
        virality: number;
        blended: number;
      }> = [];
      let aiJudgeAttempts = 0;
      let aiJudgeSuccess = 0;
      let aiJudgeFallback = 0;
      let aiNoiseFiltered = 0;
      let aiTransformRequiredSkipped = 0;
      let lowValueTitleSkipped = 0;
      const aiProvidersUsed = new Set<string>();
      if (aiPostScrapeBatch.provider) {
        aiProvidersUsed.add(aiPostScrapeBatch.provider);
      }
      const noiseFilteredBySource: Record<string, number> = {};

      for (const input of selectedSignalInputs) {
        const { event, signalId, topic, ideaDraft } = input;
        try {
          const aiInsight = aiPostScrapeInsights.get(signalId);
          if (aiInsight?.isNoise) {
            aiNoiseFiltered += 1;
            noiseFilteredBySource[event.source] = (noiseFilteredBySource[event.source] ?? 0) + 1;
            continue;
          }

          const requiresAiRewrite =
            event.source === 'github_issues' || event.source === 'greenhouse' || event.source === 'lever';

          if (requiresAiRewrite && aiPostScrapeSettings.maxSignals > 0 && (!aiInsight?.idea || aiInsight.idea.trim().length === 0)) {
            aiTransformRequiredSkipped += 1;
            await logger.debug(cadenceLabel, 'signal skipped because ai opportunity rewrite is unavailable', {
              source: event.source,
              source_item_id: event.source_item_id
            });
            continue;
          }

          if ((!aiInsight?.idea || aiInsight.idea.trim().length === 0) && isLowValueOpportunityTitle(ideaDraft)) {
            lowValueTitleSkipped += 1;
            await logger.debug(cadenceLabel, 'signal skipped because title appears low-value without ai rewrite', {
              source: event.source,
              source_item_id: event.source_item_id,
              idea_draft: ideaDraft
            });
            continue;
          }

          const idea = aiInsight?.idea && aiInsight.idea.length > 0 ? aiInsight.idea : ideaDraft;
          const retriever = persistentStore?.retriever ?? createInMemoryRetriever(memoryEntries);
          const canonicalText = buildRetrieverQueryText({
            idea,
            snippet: event.text.slice(0, 160),
            text: event.text,
            topic
          });

          const shouldUseAiJudge =
            aiJudgeAttempts < aiJudgeSettings.maxSignals &&
            isAiJudgeEligible(event.text) &&
            !isLowValueOpportunityTitle(idea);
          let judgeScores: [number, number, number] = aiInsight?.judgeScores ?? (aiInsight ? [55, 55, 55] : [40, 40, 40]);
          if (aiInsight?.judgeScores) {
            aiJudgeSuccess += 1;
          } else if (shouldUseAiJudge) {
            aiJudgeAttempts += 1;
            const aiJudgeResult = await judgeBuildabilityWithAi({
              idea,
              text: event.text,
              topic,
              source: event.source,
              settings: aiJudgeSettings,
              logger,
              circuit
            });
            judgeScores = aiJudgeResult.judgeScores;

            if (aiJudgeResult.fromAi) {
              aiJudgeSuccess += 1;
            } else {
              aiJudgeFallback += 1;
            }

            if (aiJudgeResult.providers && aiJudgeResult.providers.length > 0) {
              for (const provider of aiJudgeResult.providers) {
                aiProvidersUsed.add(provider);
              }
            } else if (aiJudgeResult.provider) {
              aiProvidersUsed.add(aiJudgeResult.provider);
            }
            runAiHealth = applyAiAttempts(runAiHealth, aiJudgeResult.attempts);
            aiHealth = runAiHealth;
          }

          const scoreArgs: Parameters<typeof scoreSignalWithRetriever>[0] = {
            text: event.text,
            judgeScores,
            topic,
            source: event.source,
            canonicalText,
            memoryRetriever: retriever,
            topK: 8
          };
          if (aiInsight?.demand !== undefined) scoreArgs.baseDemand = aiInsight.demand;
          if (aiInsight?.timing !== undefined) scoreArgs.baseTiming = aiInsight.timing;
          if (aiInsight?.virality !== undefined) scoreArgs.baseVirality = aiInsight.virality;
          const score = await scoreSignalWithRetriever(scoreArgs);

          // Engagement boost: high-engagement signals from sources with metrics get score boosts
          const eng = event.engagement_count ?? 0;
          if (eng >= 200) {
            score.demand = Math.min(100, score.demand + 15);
            score.virality = Math.min(100, score.virality + 10);
          } else if (eng >= 50) {
            score.demand = Math.min(100, score.demand + 10);
            score.virality = Math.min(100, score.virality + 5);
          } else if (eng >= 10) {
            score.demand = Math.min(100, score.demand + 5);
          }
          if (eng >= 10) {
            score.blended = blendedScore(score);
          }

          const blended = applySourceQualityPenalty({
            source: event.source,
            idea,
            text: event.text,
            blended: score.blended
          });

          const indexedEntry = await indexSignalMemory({
            signalId,
            topic,
            source: event.source,
            idea,
            snippet: event.text.slice(0, 160),
            text: event.text,
            observedAt: event.source_timestamp,
            demand: score.demand,
            timing: score.timing,
            buildability: score.buildability,
            blended,
            virality: score.virality ?? aiInsight?.virality ?? 0,
            sourceUrl: event.url || null
          });

          memoryEntries.push(indexedEntry);

          if (persistentStore) {
            try {
              await persistentStore.save(indexedEntry);

              // Multi-source convergence boost: if similar signals exist from other sources within 48h, boost virality
              if (indexedEntry.embeddingRecord.embedding) {
                const convergent = await persistentStore.findConvergentSignals(
                  indexedEntry.memoryRecord.signal_id,
                  indexedEntry.embeddingRecord.embedding,
                  event.source
                );
                if (convergent.length > 0) {
                  const convergenceBoost = Math.min(25, 15 + convergent.length * 5);
                  // Boost the current signal
                  await persistentStore.boostViralityScore(indexedEntry.memoryRecord.signal_id, convergenceBoost);
                  // Boost the matched signals too
                  for (const match of convergent) {
                    await persistentStore.boostViralityScore(match.signal_id, convergenceBoost);
                  }
                  await logger.debug(cadenceLabel, 'convergence boost applied', {
                    signal_id: indexedEntry.memoryRecord.signal_id,
                    matches: convergent.length,
                    boost: convergenceBoost,
                    matched_sources: convergent.map((m) => m.source)
                  });
                }
              }
            } catch (error) {
              await logger.error(cadenceLabel, 'persistent memory save failed', {
                signal_id: indexedEntry.memoryRecord.signal_id,
                error: toErrorMessage(error)
              });
            }
          }

          scoredSignals.push({
            id: signalId,
            idea,
            top_source: event.source,
            snippet: aiInsight?.rationale && aiInsight.rationale.length > 0 ? aiInsight.rationale : event.text.slice(0, 160),
            source_url: event.url,
            demand: score.demand,
            timing: score.timing,
            buildability: score.buildability,
            virality: score.virality ?? aiInsight?.virality ?? 0,
            blended
          });
        } catch (error) {
          await logger.error(cadenceLabel, 'signal scoring failed', {
            source: event.source,
            source_item_id: event.source_item_id,
            error: toErrorMessage(error)
          });
        }
      }

      if (aiNoiseFiltered > 0) {
        await logger.info(cadenceLabel, 'ai post-scrape noise filtered', {
          filtered_count: aiNoiseFiltered,
          by_source: noiseFilteredBySource
        });
      }

      await logger.info(cadenceLabel, 'ai judge summary', {
        post_scrape_enabled: aiPostScrapeSettings.enabled,
        post_scrape_attempted: aiPostScrapeBatch.attempted,
        post_scrape_provider: aiPostScrapeBatch.provider ?? null,
        post_scrape_insights: aiPostScrapeInsights.size,
        post_scrape_noise_filtered: aiNoiseFiltered,
        post_scrape_transform_required_skipped: aiTransformRequiredSkipped,
        low_value_title_skipped: lowValueTitleSkipped,
        max_signals: aiJudgeSettings.maxSignals,
        attempts: aiJudgeAttempts,
        successful: aiJudgeSuccess,
        fallback: aiJudgeFallback,
        providers_used: Array.from(aiProvidersUsed),
        provider_health: runAiHealth.providers
      });

      const now = Date.now();
      const refreshedAtIso = new Date(now).toISOString();
      const rankedSignals = rankAndPreparePublish(scoredSignals);

      // On hourly-only refreshes, retain signals from sources that weren't refreshed (daily sources)
      // so they don't disappear until the next daily refresh replaces them
      let nextSignals: FeedRecord[];
      if (rankedSignals.length > 0) {
        const refreshedSources = new Set(rankedSignals.map((s) => s.top_source));
        const retainedSignals = snapshot.signals.filter((s) => !refreshedSources.has(s.top_source));
        nextSignals = [...rankedSignals, ...retainedSignals].sort((a, b) => b.score - a.score);
      } else {
        nextSignals = snapshot.signals;
      }

      const ideaCandidates = findIdeaCandidates(nextSignals);

      if (rankedSignals.length === 0 && snapshot.signals.length > 0) {
        await logger.warn(cadenceLabel, 'no fresh signals, serving previous snapshot');
      }

      if (ideaCandidates.length > 0) {
        await logger.info(cadenceLabel, 'idea candidate detected', {
          count: ideaCandidates.length,
          ideas: ideaCandidates.map((signal) => ({
            score: signal.score,
            source: signal.top_source,
            idea: signal.idea
          }))
        });
      } else {
        await logger.info(cadenceLabel, 'no idea candidate detected', {
          top_score: nextSignals[0]?.score ?? null
        });
      }

      snapshot = {
        refreshedAt: now,
        signals: nextSignals,
        connectors: toConnectorStatus(env, hourly, daily, byo, refreshedAtIso, dailyDue ? now : snapshot.lastDailyRunAt),
        lastHourlyRunAt: now,
        lastDailyRunAt: dailyDue ? now : snapshot.lastDailyRunAt
      };
      aiHealth = {
        ...runAiHealth,
        refreshed_at: refreshedAtIso,
        providers: runAiHealth.providers.map((p) => ({
          ...p,
          status: p.enabled ? 'idle' as const : 'disabled' as const,
          attempted: 0,
          succeeded: 0,
          failed: 0,
          retries: 0
        }))
      };
      await persistSnapshotToDisk(process.env, logger, snapshot);

      await logger.info(cadenceLabel, `=== ${dailyDue ? 'DAILY' : 'HOURLY'} REFRESH COMPLETE ===`, {
        run_id: logger.runId,
        events: events.length,
        published_signals: snapshot.signals.length,
        duration_s: Math.round((Date.now() - refreshStartedAt) / 1000)
      });

      return snapshot;
    } catch (error) {
      const message = toErrorMessage(error);
      await logger.error(cadenceLabel, `=== ${dailyDue ? 'DAILY' : 'HOURLY'} REFRESH FAILED ===`, {
        run_id: logger.runId,
        error: message
      });

      if (snapshot.refreshedAt > 0) {
        await logger.warn(cadenceLabel, 'serving stale snapshot after refresh failure', {
          previous_refreshed_at: new Date(snapshot.refreshedAt).toISOString()
        });
        aiHealth = {
          ...runAiHealth,
          refreshed_at: new Date(snapshot.refreshedAt).toISOString()
        };
        return snapshot;
      }

      const now = Date.now();
      const refreshedAtIso = new Date(now).toISOString();
      snapshot = {
        refreshedAt: now,
        signals: [],
        connectors: toErrorFirstSnapshot(env, refreshedAtIso),
        lastHourlyRunAt: now,
        lastDailyRunAt: snapshot.lastDailyRunAt
      };
      aiHealth = {
        ...runAiHealth,
        refreshed_at: refreshedAtIso
      };

      return snapshot;
    } finally {
      refreshingCadence = null;
    }
  };

  const startRefresh = (): Promise<Snapshot> => {
    if (!refreshInFlight) {
      refreshInFlight = refresh().finally(() => {
        refreshInFlight = null;
      });
    }

    return refreshInFlight;
  };

  const ensureFresh = async (): Promise<Snapshot> => {
    if (!snapshotHydrated) {
      const runId = process.env.RUN_ID ?? createRunId('read_model_boot');
      const logger = createExecutionLogger({ env: process.env, runId });
      sessionRunIds.add(logger.runId);
      await hydrateSnapshotFromDisk(process.env, logger);
    }

    const stale = Date.now() - snapshot.refreshedAt > refreshMs;
    const isSyncRefreshMode = refreshMs === 0 || process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

    if (stale) {
      if (isSyncRefreshMode) {
        return startRefresh();
      }

      void startRefresh();
      return snapshot;
    }

    return snapshot;
  };

  const DAILY_CADENCE_MS = 24 * 60 * 60 * 1000;

  return {
    listSignals: async (): Promise<FeedRecord[]> => (await ensureFresh()).signals,
    listConnectors: async (): Promise<ConnectorStatusRecord[]> => (await ensureFresh()).connectors,
    getRefreshMeta: () => ({
      last_hourly_run: new Date(snapshot.lastHourlyRunAt > 0 ? snapshot.lastHourlyRunAt : startedAt).toISOString(),
      last_daily_run: new Date(snapshot.lastDailyRunAt > 0 ? snapshot.lastDailyRunAt : startedAt).toISOString(),
      hourly_interval_ms: refreshMs,
      daily_interval_ms: DAILY_CADENCE_MS,
      refreshing: refreshingCadence,
    }),
    getAiHealth: async (): Promise<AiHealthRecord> => {
      await ensureFresh();
      if (!circuit) return aiHealth;
      const circuitStatus = circuit.getStatus();
      return {
        ...aiHealth,
        providers: aiHealth.providers.map((p) => ({
          ...p,
          circuit_state: circuitStatus[p.provider].state,
          circuit_failures: circuitStatus[p.provider].consecutiveFailures,
        }))
      };
    },
    listLogs: async (query: ListLogsQuery): Promise<ExecutionLogRecord[]> =>
      (await (async () => {
        const logArgs: Parameters<typeof readExecutionLogs>[0] = {
          env: process.env,
          limit: query.scope === 'all' ? query.limit : 1000
        };
        if (query.level !== undefined) logArgs.level = query.level;
        if (query.run_id !== undefined) logArgs.runId = query.run_id;
        if (query.component !== undefined) logArgs.component = query.component;
        const rows = await readExecutionLogs(logArgs);

        if (query.scope === 'all' || query.run_id) {
          return rows.slice(0, query.limit);
        }

        return rows.filter((row) => sessionRunIds.has(row.run_id)).slice(0, query.limit);
      })()),
    registerRunId: (runId: string) => { sessionRunIds.add(runId); },
    refresh,
    close: async (): Promise<void> => {
      if (postgresMemoryStore) {
        await postgresMemoryStore.close();
      }
    }
  };
};
