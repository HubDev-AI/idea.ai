// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
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

  it('applies thesis-active class when isActive is true', () => {
    const { container } = render(
      <ThesisCard
        thesis={{
          canonicalKey: 'test',
          title: 'Test Thesis',
          confidence: 50,
          status: 'watching',
          evidenceCount: 2,
          problemStatement: 'Test problem',
          sourceCount: 1
        }}
        isActive={true}
      />
    );

    expect(container.querySelector('.thesis-active')).toBeTruthy();
  });

  it('calls onClick when card is clicked', () => {
    const handleClick = vi.fn();
    render(
      <ThesisCard
        thesis={{
          canonicalKey: 'test',
          title: 'Clickable',
          confidence: 60,
          status: 'watching',
          evidenceCount: 1,
          problemStatement: 'Click me',
          sourceCount: 1
        }}
        onClick={handleClick}
      />
    );

    fireEvent.click(screen.getByText('Clickable'));
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('renders scope badge for small/medium/large', () => {
    const { rerender } = render(
      <ThesisCard
        thesis={{
          canonicalKey: 's',
          title: 'Small App',
          confidence: 90,
          status: 'promoted',
          evidenceCount: 8,
          problemStatement: 'p',
          sourceCount: 2,
          estimatedScope: 'small'
        }}
      />
    );
    expect(screen.getByText('S')).toBeTruthy();

    rerender(
      <ThesisCard
        thesis={{
          canonicalKey: 'm',
          title: 'Medium App',
          confidence: 50,
          status: 'watching',
          evidenceCount: 3,
          problemStatement: 'p',
          sourceCount: 1,
          estimatedScope: 'medium'
        }}
      />
    );
    expect(screen.getByText('M')).toBeTruthy();

    rerender(
      <ThesisCard
        thesis={{
          canonicalKey: 'l',
          title: 'Large App',
          confidence: 30,
          status: 'candidate',
          evidenceCount: 1,
          problemStatement: 'p',
          sourceCount: 1,
          estimatedScope: 'large'
        }}
      />
    );
    expect(screen.getByText('L')).toBeTruthy();
  });

  it('handles null estimatedScope without rendering badge', () => {
    render(
      <ThesisCard
        thesis={{
          canonicalKey: 'n',
          title: 'No Scope',
          confidence: 45,
          status: 'candidate',
          evidenceCount: 1,
          problemStatement: 'p',
          sourceCount: 1,
          estimatedScope: null
        }}
      />
    );

    expect(screen.queryByText('S')).toBeNull();
    expect(screen.queryByText('M')).toBeNull();
    expect(screen.queryByText('L')).toBeNull();
  });

  it('clamps confidence bar at 100%', () => {
    const { container } = render(
      <ThesisCard
        thesis={{
          canonicalKey: 'over',
          title: 'Over 100',
          confidence: 120,
          status: 'promoted',
          evidenceCount: 15,
          problemStatement: 'p',
          sourceCount: 5
        }}
      />
    );

    const fill = container.querySelector('.thesis-confidence-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });
});
