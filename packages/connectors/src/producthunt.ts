import type { RawEventInput } from './common/http';

type PHNode = {
  id: string;
  name: string;
  tagline: string;
  url: string;
  createdAt: string;
  votesCount: number;
  topics: { edges: { node: { name: string } }[] };
};

type PHResponse = {
  data: { posts: { edges: { node: PHNode }[] } };
};

const PH_GRAPHQL_URL = 'https://api.producthunt.com/v2/api/graphql';

const POSTS_QUERY = `query { posts(order: NEWEST, first: 20) { edges { node { id name tagline url createdAt votesCount topics { edges { node { name } } } } } } }`;

export const fetchProductHunt = async (options: {
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<RawEventInput[]> => {
  const token = options.token ?? process.env.PH_API_TOKEN;
  if (!token) return [];

  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(PH_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ query: POSTS_QUERY })
  });

  if (!response.ok) return [];

  const data = (await response.json()) as PHResponse;

  return (data.data?.posts?.edges ?? []).map(({ node }) => {
    const topics = node.topics.edges.map((e) => e.node.name).join(', ');
    return {
      source: 'producthunt',
      source_item_id: `ph:${node.id}`,
      source_timestamp: node.createdAt,
      text: `${node.name}: ${node.tagline} (${node.votesCount} votes, topics: ${topics})`,
      url: node.url
    };
  });
};
