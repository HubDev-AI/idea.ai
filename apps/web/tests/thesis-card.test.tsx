// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React from 'react';
import { describe, expect, it } from 'vitest';
import { ThesisCard } from '../src/components/ThesisCard';

describe('ThesisCard', () => {
  it('renders thesis title, confidence, and status', () => {
    render(
      <ThesisCard
        thesis={{
          canonicalKey: 'test',
          title: 'SOC2 Compliance Copilot',
          confidence: 82,
          status: 'promoted',
          evidenceCount: 12,
          problemStatement: 'Compliance is painful',
          sourceCount: 3
        }}
      />
    );

    expect(screen.getByText('SOC2 Compliance Copilot')).toBeTruthy();
    expect(screen.getByText(/82%/)).toBeTruthy();
    expect(screen.getByText(/promoted/i)).toBeTruthy();
  });
});
