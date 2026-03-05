/** Display names for connectors shown in the UI */
export const connectorDisplayName: Record<string, string> = {
  hn: 'Hacker News',
  github_issues: 'GitHub Issues',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  yc_companies: 'YC Companies',
  reddit: 'Reddit',
  producthunt: 'Product Hunt',
  appstore_trending: 'App Store',
  indiehackers: 'IndieHackers',
  lobsters: 'Lobsters',
  devto: 'Dev.to',
  showhn: 'Show HN',
  mastodon: 'Mastodon',
  bluesky: 'Bluesky',
  homebrew: 'Homebrew',
  exa_byo: 'Exa',
  perigon_byo: 'Perigon',
  twitter_byo: 'Twitter/X',
};

/** Maps connector config name to the source key stored in signal_memory */
export const connectorSourceKey: Record<string, string> = {
  hn: 'hacker_news',
};
