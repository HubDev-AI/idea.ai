import { type ByoConnectorResult, evaluateByoGuard } from './byo_guard';
import { fetchJsonWithRetry, type RawEventInput } from './common/http';

type ExaResult = {
  id: string;
  publishedDate?: string;
  title?: string;
  text?: string;
  url: string;
};

const defaultExaLoader = async (apiKey: string): Promise<RawEventInput[]> => {
  const response = await fetchJsonWithRetry<{ results?: ExaResult[] }>('https://api.exa.ai/search', {
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        query: 'startup pain points SaaS founder'
      })
    }
  });

  return (response.results ?? []).map((item) => ({
    source: 'exa',
    source_item_id: item.id,
    source_timestamp: item.publishedDate ?? new Date().toISOString(),
    text: `${item.title ?? ''}\n${item.text ?? ''}`.trim(),
    url: item.url
  }));
};

export const runExaByoConnector = async (
  env: NodeJS.ProcessEnv = process.env,
  loadEvents: (apiKey: string) => Promise<RawEventInput[]> = defaultExaLoader
): Promise<ByoConnectorResult> => {
  const guard = evaluateByoGuard({
    connector: 'exa_byo',
    apiKey: env.EXA_API_KEY,
    budgetValue: env.EXA_DAILY_BUDGET_USD,
    fallbackBudget: 5
  });

  if (!guard.allowed) {
    return {
      status: 'skipped',
      reason: guard.reason,
      events: [],
      telemetry: guard.telemetry
    };
  }

  const events = await loadEvents(env.EXA_API_KEY as string);

  return {
    status: 'active',
    events,
    telemetry: {
      connector: 'exa_byo',
      skipped: false,
      budget_usd: guard.budgetUsd
    }
  };
};
