import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput, withRetry } from './common/http';

type GreenhouseJob = {
  id: number;
  updated_at?: string;
  title: string;
  absolute_url: string;
  content?: string;
};

type GreenhouseResponse = {
  jobs: GreenhouseJob[];
};

type GreenhouseLoader = (limit: number) => Promise<GreenhouseResponse>;

const defaultGreenhouseLoader: GreenhouseLoader = (limit) =>
  fetchJsonWithRetry<GreenhouseResponse>(
    `https://boards-api.greenhouse.io/v1/boards?content=true&limit=${limit}`
  );

export const fetchGreenhouseJobEvents = async (
  loadJobs: GreenhouseLoader = defaultGreenhouseLoader,
  limit = OPEN_CONNECTOR_LIMITS.greenhouse
): Promise<RawEventInput[]> => {
  const response = await withRetry(() => loadJobs(limit));

  return response.jobs.slice(0, limit).map((job) => ({
    source: 'greenhouse',
    source_item_id: String(job.id),
    source_timestamp: job.updated_at ?? new Date().toISOString(),
    text: `${job.title}\n${job.content ?? ''}`.trim(),
    url: job.absolute_url
  }));
};
