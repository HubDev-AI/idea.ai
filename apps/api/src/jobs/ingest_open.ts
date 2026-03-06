import { fetchAlternativeTo } from '@idea/connectors/src/alternativeto';
import { fetchAppStoreTrending } from '@idea/connectors/src/appstore';
import { fetchBlueskyEvents } from '@idea/connectors/src/bluesky';
import { type Cadence, OPEN_CONNECTOR_CADENCE, type RawEventInput } from '@idea/connectors/src/common/http';
import { fetchDevtoEvents } from '@idea/connectors/src/devto';
import { fetchG2Trending } from '@idea/connectors/src/g2_reviews';
import { fetchGithubIssueEvents } from '@idea/connectors/src/github_issues';
import { fetchGoogleTrends } from '@idea/connectors/src/google_trends';
import { fetchGreenhouseJobEvents } from '@idea/connectors/src/greenhouse';
import { fetchHnEvents } from '@idea/connectors/src/hn';
import { fetchHomebrewEvents } from '@idea/connectors/src/homebrew';
import { fetchIndieHackersEvents } from '@idea/connectors/src/indiehackers';
import { fetchLeverJobEvents } from '@idea/connectors/src/lever';
import { fetchLobstersEvents } from '@idea/connectors/src/lobsters';
import { fetchMastodonEvents } from '@idea/connectors/src/mastodon';
import { fetchProductHunt } from '@idea/connectors/src/producthunt';
import { fetchReddit } from '@idea/connectors/src/reddit';
import { fetchShowHnEvents } from '@idea/connectors/src/showhn';
import { fetchStackOverflow } from '@idea/connectors/src/stackoverflow';
import { fetchTikTokCreative } from '@idea/connectors/src/tiktok_creative';
import { fetchYcCompanyEvents } from '@idea/connectors/src/yc_companies';
import type { ExecutionLogger } from '../runtime/execution_logger';

export type OpenConnectorName = 'hn' | 'github_issues' | 'greenhouse' | 'lever' | 'yc_companies' | 'reddit' | 'producthunt' | 'appstore_trending' | 'indiehackers' | 'lobsters' | 'devto' | 'showhn' | 'mastodon' | 'bluesky' | 'homebrew' | 'google_trends' | 'tiktok_creative' | 'alternativeto' | 'stackoverflow' | 'g2_reviews';

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

const CONNECTOR_ORDER: OpenConnectorName[] = ['hn', 'github_issues', 'greenhouse', 'lever', 'yc_companies', 'reddit', 'producthunt', 'appstore_trending', 'indiehackers', 'lobsters', 'devto', 'showhn', 'mastodon', 'bluesky', 'homebrew', 'google_trends', 'tiktok_creative', 'alternativeto', 'stackoverflow', 'g2_reviews'];

const defaultLoaders: Record<OpenConnectorName, OpenConnectorLoader> = {
  hn: () => fetchHnEvents(),
  github_issues: () => fetchGithubIssueEvents(),
  greenhouse: () => fetchGreenhouseJobEvents(),
  lever: () => fetchLeverJobEvents(),
  yc_companies: () => fetchYcCompanyEvents(),
  reddit: () => {
    const redditOpts: Parameters<typeof fetchReddit>[0] = {};
    if (process.env.REDDIT_SUBREDDITS !== undefined) {
      redditOpts.subreddits = process.env.REDDIT_SUBREDDITS.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return fetchReddit(redditOpts);
  },
  producthunt: () => fetchProductHunt(),
  appstore_trending: () => fetchAppStoreTrending(),
  indiehackers: () => fetchIndieHackersEvents(),
  lobsters: () => fetchLobstersEvents(),
  devto: () => fetchDevtoEvents(),
  showhn: () => fetchShowHnEvents(),
  mastodon: () => fetchMastodonEvents(),
  bluesky: () => fetchBlueskyEvents(),
  homebrew: () => fetchHomebrewEvents(),
  google_trends: () => fetchGoogleTrends(),
  tiktok_creative: () => fetchTikTokCreative(),
  alternativeto: () => fetchAlternativeTo(),
  stackoverflow: () => fetchStackOverflow(),
  g2_reviews: () => fetchG2Trending()
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
