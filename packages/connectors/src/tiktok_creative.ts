import { type RawEventInput, withRetry } from './common/http';

type TikTokTrend = {
  hashtag_name: string;
  video_count?: number;
  view_count?: number;
};

type TikTokResponse = {
  data?: {
    trend_list?: TikTokTrend[];
  };
};

type TikTokLoaderFn = (limit: number) => Promise<TikTokResponse>;

const CREATIVE_CENTER_URL = 'https://ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/list?period=7&page=1&limit=50&country_code=US';

const defaultLoader: TikTokLoaderFn = async () => {
  return withRetry(async () => {
    const res = await fetch(CREATIVE_CENTER_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`TikTok Creative Center failed: ${res.status}`);
    return res.json() as Promise<TikTokResponse>;
  });
};

export const fetchTikTokCreative = async (
  loadData: TikTokLoaderFn = defaultLoader,
  limit = 30
): Promise<RawEventInput[]> => {
  const response = await loadData(limit);
  const trends = response.data?.trend_list ?? [];

  return trends.slice(0, limit).map((trend): RawEventInput => ({
    source: 'tiktok_creative',
    source_item_id: `tiktok:${trend.hashtag_name}`,
    source_timestamp: new Date().toISOString(),
    text: `Trending on TikTok: #${trend.hashtag_name} (${formatCount(trend.view_count ?? 0)} views, ${formatCount(trend.video_count ?? 0)} videos)`,
    url: `https://www.tiktok.com/tag/${trend.hashtag_name}`,
    engagement_count: trend.view_count ?? 0,
  }));
};

const formatCount = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
};
