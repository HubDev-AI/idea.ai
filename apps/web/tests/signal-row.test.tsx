// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React from 'react';
import { describe, expect, it } from 'vitest';
import { SignalRow } from '../src/components/SignalRow';

const baseSignal = {
  idea: 'SOC2 prep copilot',
  score: 82,
  top_source: 'hacker_news',
  snippet: 'Compliance blockers found',
  source_url: 'https://example.com',
  next_action: 'validate_demand' as const,
  updated_at: new Date().toISOString()
};

describe('SignalRow', () => {
  it('renders signal title, score, source, and snippet', () => {
    render(<SignalRow signal={baseSignal} />);

    expect(screen.getByText('SOC2 prep copilot')).toBeTruthy();
    expect(screen.getByText('82')).toBeTruthy();
    expect(screen.getByText('hacker_news')).toBeTruthy();
    expect(screen.getByText(/Compliance blockers/i)).toBeTruthy();
  });

  it('renders breakdown chips when pain/timing/buildability are present', () => {
    render(
      <SignalRow signal={{ ...baseSignal, pain: 72, timing: 61, buildability: 55 }} />
    );

    expect(screen.getByText('72')).toBeTruthy();
    expect(screen.getByText('61')).toBeTruthy();
    expect(screen.getByText('55')).toBeTruthy();
    expect(screen.getByText('Pain')).toBeTruthy();
    expect(screen.getByText('Timing')).toBeTruthy();
    expect(screen.getByText('Build')).toBeTruthy();
  });

  it('hides breakdown chips when scores are absent', () => {
    render(<SignalRow signal={baseSignal} />);

    expect(screen.queryByText('Pain')).toBeNull();
    expect(screen.queryByText('Timing')).toBeNull();
    expect(screen.queryByText('Build')).toBeNull();
  });

  it('toggles reasoning on click', () => {
    render(
      <SignalRow signal={{ ...baseSignal, reasoning: 'This signal indicates strong demand.' }} />
    );

    expect(screen.queryByText(/strong demand/i)).toBeNull();

    fireEvent.click(screen.getByText('Show reasoning'));
    expect(screen.getByText(/strong demand/i)).toBeTruthy();

    fireEvent.click(screen.getByText('Hide reasoning'));
    expect(screen.queryByText(/strong demand/i)).toBeNull();
  });

  it('hides reasoning toggle when no reasoning provided', () => {
    render(<SignalRow signal={baseSignal} />);

    expect(screen.queryByText('Show reasoning')).toBeNull();
  });

  it('renders source link when source_url is present', () => {
    render(<SignalRow signal={baseSignal} />);

    const link = screen.getByRole('link', { name: /Source/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('https://example.com');
  });
});
