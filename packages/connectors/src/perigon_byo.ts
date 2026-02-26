import { type ByoConnectorResult, evaluateByoGuard } from './byo_guard';
import { fetchJsonWithRetry, type RawEventInput } from './common/http';

type PerigonArticle = {
  articleId: string;
  pubDate?: string;
  title?: string;
  description?: string;
  url: string;
};

const defaultPerigonLoader = async (apiKey: string): Promise<RawEventInput[]> => {
  const response = await fetchJsonWithRetry<{ articles?: PerigonArticle[] }>('https://api.goperigon.com/v1/all', {
    init: {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    }
  });

  return (response.articles ?? []).map((article) => ({
    source: 'perigon',
    source_item_id: article.articleId,
    source_timestamp: article.pubDate ?? new Date().toISOString(),
    text: `${article.title ?? ''}\n${article.description ?? ''}`.trim(),
    url: article.url
  }));
};

export const runPerigonByoConnector = async (
  env: NodeJS.ProcessEnv = process.env,
  loadEvents: (apiKey: string) => Promise<RawEventInput[]> = defaultPerigonLoader
): Promise<ByoConnectorResult> => {
  const guard = evaluateByoGuard({
    connector: 'perigon_byo',
    apiKey: env.PERIGON_API_KEY,
    budgetValue: env.PERIGON_DAILY_BUDGET_USD,
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

  const events = await loadEvents(env.PERIGON_API_KEY as string);

  return {
    status: 'active',
    events,
    telemetry: {
      connector: 'perigon_byo',
      skipped: false,
      budget_usd: guard.budgetUsd
    }
  };
};
