import { describe, expect, it } from 'vitest';
import { SIGNAL_VERSION } from '../src/signal';

describe('workspace smoke', () => {
  it('loads shared contracts package', () => {
    expect(SIGNAL_VERSION).toBe('v1');
  });
});
