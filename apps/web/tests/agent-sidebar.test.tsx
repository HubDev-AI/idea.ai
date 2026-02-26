// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React from 'react';
import { describe, expect, it } from 'vitest';
import { AgentSidebar } from '../src/components/AgentSidebar';

describe('AgentSidebar', () => {
  it('shows last run time and thesis updates', () => {
    render(
      <AgentSidebar
        lastRun={{ timestamp: '2026-02-25T08:00:00Z', thesesUpdated: 2, newCandidates: 1 }}
        investigateNext="AI billing patterns"
      />
    );

    expect(screen.getByText(/2 theses updated/i)).toBeTruthy();
    expect(screen.getByText(/AI billing/i)).toBeTruthy();
  });

  it('shows pending state when no runs yet', () => {
    render(<AgentSidebar lastRun={null} investigateNext={null} />);
    expect(screen.getByText(/no runs yet/i)).toBeTruthy();
  });
});
