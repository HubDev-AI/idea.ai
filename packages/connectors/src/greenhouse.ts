import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput } from './common/http';

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

const buildGreenhouseLoader = (boardToken: string): GreenhouseLoader => (limit) =>
  fetchJsonWithRetry<GreenhouseResponse>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true&limit=${limit}`
  );

export const fetchGreenhouseJobEvents = async (
  loadJobs?: GreenhouseLoader,
  limit = OPEN_CONNECTOR_LIMITS.greenhouse,
  env: NodeJS.ProcessEnv = process.env
): Promise<RawEventInput[]> => {
  const boardToken = env.GREENHOUSE_BOARD_TOKEN;
  const loader = loadJobs ?? (boardToken ? buildGreenhouseLoader(boardToken) : undefined);

  if (!loader) {
    throw new Error('GREENHOUSE_BOARD_TOKEN is required for greenhouse connector');
  }

  const response = await loader(limit);

  return response.jobs.slice(0, limit).map((job) => ({
    source: 'greenhouse',
    source_item_id: String(job.id),
    source_timestamp: job.updated_at ?? new Date().toISOString(),
    text: `${job.title}\n${job.content ?? ''}`.trim(),
    url: job.absolute_url
  }));
};
