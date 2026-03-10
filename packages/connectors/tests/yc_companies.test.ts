import { describe, expect, it } from 'vitest';
import { fetchYcCompanyEvents } from '../src/yc_companies';

describe('yc_companies connector', () => {
  it('rejects Algolia app ID with non-alphanumeric characters', async () => {
    const maliciousLoader = async () => ({ app: 'evil.attacker.com/api#', key: 'validkey123' });
    await expect(fetchYcCompanyEvents(maliciousLoader, async () => [], 10)).rejects.toThrow('Invalid Algolia app ID');
  });
});
