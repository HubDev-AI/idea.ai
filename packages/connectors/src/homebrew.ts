import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput } from './common/http';

type HomebrewAnalyticsResponse = {
  start_date: string;
  end_date: string;
  total_items: number;
  total_count: number;
  items: Array<{
    number: number;
    formula: string;
    count: string;
    percent: string;
  }>;
};

type HomebrewLoaderFn = () => Promise<HomebrewAnalyticsResponse>;

const defaultLoader: HomebrewLoaderFn = async () =>
  fetchJsonWithRetry<HomebrewAnalyticsResponse>(
    'https://formulae.brew.sh/api/analytics/install-on-request/30d.json',
    { init: { headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' } } }
  );

// Focus on developer-relevant formulae (skip system libs, codecs, etc.)
const DEV_TOOL_KEYWORDS = [
  'cli', 'git', 'node', 'go', 'rust', 'python', 'ruby', 'deno', 'bun',
  'docker', 'kubectl', 'terraform', 'aws', 'gh', 'jq', 'fzf', 'ripgrep',
  'fd', 'bat', 'exa', 'eza', 'zoxide', 'starship', 'tmux', 'neovim',
  'uv', 'cargo', 'pnpm', 'yarn', 'cmake', 'make', 'just', 'task',
  'ollama', 'gemini', 'claude', 'copilot', 'cursor'
];

const isDevRelated = (formula: string): boolean =>
  DEV_TOOL_KEYWORDS.some((kw) => formula.includes(kw)) || formula.length <= 6;

export const fetchHomebrewEvents = async (
  loadItems: HomebrewLoaderFn = defaultLoader,
  limit = OPEN_CONNECTOR_LIMITS.homebrew
): Promise<RawEventInput[]> => {
  const data = await loadItems();
  const items = data.items ?? [];

  return items
    .filter((item) => isDevRelated(item.formula))
    .slice(0, limit)
    .map((item) => ({
      source: 'homebrew',
      source_item_id: `brew:${item.formula}`,
      source_timestamp: data.end_date ? new Date(data.end_date).toISOString() : new Date().toISOString(),
      text: `${item.formula} — ${Number(item.count.replace(/,/g, '')).toLocaleString()} installs in 30 days (rank #${item.number})`,
      url: `https://formulae.brew.sh/formula/${item.formula}`
    }));
};
