import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput, withRetry } from './common/http';

type LeverJob = {
  id: string;
  createdAt: number;
  text: string;
  descriptionPlain?: string;
  hostedUrl: string;
};

type LeverLoader = (limit: number) => Promise<LeverJob[]>;

const defaultLeverLoader: LeverLoader = (limit) =>
  fetchJsonWithRetry<LeverJob[]>(`https://api.lever.co/v0/postings?mode=json&limit=${limit}`);

export const fetchLeverJobEvents = async (
  loadJobs: LeverLoader = defaultLeverLoader,
  limit = OPEN_CONNECTOR_LIMITS.lever
): Promise<RawEventInput[]> => {
  const jobs = await withRetry(() => loadJobs(limit));

  return jobs.slice(0, limit).map((job) => ({
    source: 'lever',
    source_item_id: job.id,
    source_timestamp: new Date(job.createdAt).toISOString(),
    text: `${job.text}\n${job.descriptionPlain ?? ''}`.trim(),
    url: job.hostedUrl
  }));
};
