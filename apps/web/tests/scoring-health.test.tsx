// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScoringHealth } from '../src/components/ScoringHealth';

const mockRecord = {
  currentWeights: {
    profileId: 'consumer',
    demand: 0.4,
    timing: 0.3,
    buildability: 0.2,
    virality: 0.1,
    source: 'optimized' as const,
  },
  optimizationHistory: [],
  predictionTrackRecord: {
    total: 12,
    validated: 9,
    accuracy: 75,
  },
  experienceLibrarySize: 4,
};

describe('ScoringHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders loading state and requests scoring health for the first profile', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(mockRecord), { status: 200 }))
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ScoringHealth
        profiles={[
          { id: 'consumer', name: 'Consumer', display: { badge: 'Consumer', badgeColor: '#3b82f6' }, dimensions: [] },
          { id: 'b2b', name: 'B2B', display: { badge: 'B2B', badgeColor: '#10b981' }, dimensions: [] },
        ]}
      />
    );

    expect(screen.getByText('Loading scoring health...')).toBeTruthy();

    await screen.findByText('Current Weights');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String((fetchMock.mock.calls as unknown as unknown[][])[0]?.[0])).toContain('/v1/scoring-health?profile=consumer');
    });
  });
});
