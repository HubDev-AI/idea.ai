import { type Cadence, OPEN_CONNECTOR_CADENCE, type RawEventInput } from '@idea/connectors/src/common/http';
import { fetchGithubIssueEvents } from '@idea/connectors/src/github_issues';
import { fetchGreenhouseJobEvents } from '@idea/connectors/src/greenhouse';
import { fetchHnEvents } from '@idea/connectors/src/hn';
import { fetchLeverJobEvents } from '@idea/connectors/src/lever';
import { fetchProductHunt } from '@idea/connectors/src/producthunt';
import { fetchReddit } from '@idea/connectors/src/reddit';
import { fetchYcCompanyEvents } from '@idea/connectors/src/yc_companies';
import type { ExecutionLogger } from '../runtime/execution_logger';

export type OpenConnectorName = 'hn' | 'github_issues' | 'greenhouse' | 'lever' | 'yc_companies' | 'reddit' | 'producthunt';

export type OpenConnectorStatus = {
  name: OpenConnectorName;
  cadence: Cadence;
  status: 'active' | 'error';
  last_error?: string;
};

export type OpenConnectorIngestionResult = {
  events: RawEventInput[];
  statuses: OpenConnectorStatus[];
};

type OpenConnectorLoader = () => Promise<RawEventInput[]>;

type OpenIngestionDeps = {
  logger?: ExecutionLogger;
  enabledConnectors?: OpenConnectorName[];
  loaders?: Partial<Record<OpenConnectorName, OpenConnectorLoader>>;
};

const CONNECTOR_ORDER: OpenConnectorName[] = ['hn', 'github_issues', 'greenhouse', 'lever', 'yc_companies', 'reddit', 'producthunt'];

const defaultLoaders: Record<OpenConnectorName, OpenConnectorLoader> = {
  hn: () => fetchHnEvents(),
  github_issues: () => fetchGithubIssueEvents(),
  greenhouse: () => fetchGreenhouseJobEvents(),
  lever: () => fetchLeverJobEvents(),
  yc_companies: () => fetchYcCompanyEvents(),
  reddit: () => fetchReddit({}),
  producthunt: () => {
    const phOpts: Parameters<typeof fetchProductHunt>[0] = {};
    if (process.env.PH_API_TOKEN !== undefined) phOpts.token = process.env.PH_API_TOKEN;
    return fetchProductHunt(phOpts);
  }
};

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : 'Unknown error');

const resolveEnabledSet = (cadence: Cadence, enabledConnectors?: OpenConnectorName[]): Set<OpenConnectorName> => {
  if (enabledConnectors && enabledConnectors.length > 0) {
    return new Set(enabledConnectors.filter((connector) => OPEN_CONNECTOR_CADENCE[connector] === cadence));
  }

  return new Set(CONNECTOR_ORDER.filter((connector) => OPEN_CONNECTOR_CADENCE[connector] === cadence));
};

export const runOpenConnectorIngestionDetailed = async (
  cadence: Cadence,
  deps: OpenIngestionDeps = {}
): Promise<OpenConnectorIngestionResult> => {
  const enabledSet = resolveEnabledSet(cadence, deps.enabledConnectors);
  const statuses: OpenConnectorStatus[] = [];
  const events: RawEventInput[] = [];

  for (const connector of CONNECTOR_ORDER) {
    if (OPEN_CONNECTOR_CADENCE[connector] !== cadence || !enabledSet.has(connector)) {
      continue;
    }

    const loader = deps.loaders?.[connector] ?? defaultLoaders[connector];

    try {
      const loaded = await loader();
      events.push(...loaded);
      statuses.push({
        name: connector,
        cadence,
        status: 'active'
      });
      await deps.logger?.info('ingest_open', 'connector completed', {
        connector,
        cadence,
        events: loaded.length
      });
    } catch (error) {
      const message = toErrorMessage(error);
      statuses.push({
        name: connector,
        cadence,
        status: 'error',
        last_error: message
      });
      await deps.logger?.error('ingest_open', 'connector failed', {
        connector,
        cadence,
        error: message
      });
    }
  }

  return { events, statuses };
};

export const runOpenConnectorIngestion = async (
  cadence: Cadence,
  deps: OpenIngestionDeps = {}
): Promise<RawEventInput[]> => (await runOpenConnectorIngestionDetailed(cadence, deps)).events;
