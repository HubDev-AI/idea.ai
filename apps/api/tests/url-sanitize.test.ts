import { describe, expect, it } from 'vitest';
import { sanitizeUrl } from '../src/runtime/postgres_signal_store';

describe('sanitizeUrl', () => {
  it('passes through https URLs unchanged', () => {
    expect(sanitizeUrl('https://example.com/page')).toBe('https://example.com/page');
  });

  it('passes through http URLs unchanged', () => {
    expect(sanitizeUrl('http://example.com/page')).toBe('http://example.com/page');
  });

  it('returns null for javascript: URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('returns null for data: URLs', () => {
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(sanitizeUrl(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(sanitizeUrl(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(sanitizeUrl('')).toBeNull();
  });
});
