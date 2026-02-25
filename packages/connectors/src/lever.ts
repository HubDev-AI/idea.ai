import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput, withRetry } from './common/http';

type LeverJob = {
  id: string;
  createdAt: number;
  text: string;
  descriptionPlain?: string;
  hostedUrl: string;
};

type LeverLoader = (limit: number) => Promise<LeverJob[]>;

const buildLeverLoader = (site: string): LeverLoader => (limit) =>
  fetchJsonWithRetry<LeverJob[]>(
    `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json&limit=${limit}`
  );

export const fetchLeverJobEvents = async (
  loadJobs?: LeverLoader,
  limit = OPEN_CONNECTOR_LIMITS.lever,
  env: NodeJS.ProcessEnv = process.env
): Promise<RawEventInput[]> => {
  const site = env.LEVER_SITE;
  const loader = loadJobs ?? (site ? buildLeverLoader(site) : undefined);

  if (!loader) {
    throw new Error('LEVER_SITE is required for lever connector');
  }

  const jobs = await withRetry(() => loader(limit));

  return jobs.slice(0, limit).map((job) => ({
    source: 'lever',
    source_item_id: job.id,
    source_timestamp: new Date(job.createdAt).toISOString(),
    text: `${job.text}\n${job.descriptionPlain ?? ''}`.trim(),
    url: job.hostedUrl
  }));
};
