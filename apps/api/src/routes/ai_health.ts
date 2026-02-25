import type { FastifyInstance } from 'fastify';

export type AiProviderName = 'claude' | 'codex';
export type AiProviderStatus = 'disabled' | 'idle' | 'healthy' | 'degraded' | 'error';

export type AiProviderHealthRecord = {
  provider: AiProviderName;
  enabled: boolean;
  status: AiProviderStatus;
  attempted: number;
  succeeded: number;
  failed: number;
  retries: number;
  last_error: string | null;
};

export type AiHealthRecord = {
  run_id: string | null;
  refreshed_at: string | null;
  provider_setting: 'claude' | 'codex' | 'both';
  judge_mode: 'single' | 'ensemble';
  fallback_enabled: boolean;
  retry_budget: number;
  post_scrape_enabled: boolean;
  post_scrape_max_signals: number;
  judge_max_signals: number;
  providers: AiProviderHealthRecord[];
};

export const registerAiHealthRoute = (
  app: FastifyInstance,
  deps: { getAiHealth: () => Promise<AiHealthRecord> }
): void => {
  app.get('/v1/ai-health', async () => deps.getAiHealth());
};
