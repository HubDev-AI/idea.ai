import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput, withRetry } from './common/http';

type GithubIssue = {
  id: number;
  number: number;
  created_at: string;
  title: string;
  body?: string;
  html_url: string;
};

type GithubIssueLoader = (limit: number) => Promise<GithubIssue[]>;

const defaultGithubIssueLoader: GithubIssueLoader = (limit) =>
  fetchJsonWithRetry<GithubIssue[]>(
    `https://api.github.com/search/issues?q=type:issue+state:open+label:feature+sort:updated&per_page=${limit}`,
    {
      init: {
        headers: {
          Accept: 'application/vnd.github+json'
        }
      }
    }
  );

export const fetchGithubIssueEvents = async (
  loadIssues: GithubIssueLoader = defaultGithubIssueLoader,
  limit = OPEN_CONNECTOR_LIMITS.github_issues
): Promise<RawEventInput[]> => {
  const issues = await withRetry(() => loadIssues(limit));

  return issues.slice(0, limit).map((issue) => ({
    source: 'github_issues',
    source_item_id: String(issue.id),
    source_timestamp: issue.created_at,
    text: `${issue.title}\n${issue.body ?? ''}`.trim(),
    url: issue.html_url
  }));
};
