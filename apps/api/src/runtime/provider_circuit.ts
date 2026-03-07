import type { Provider } from '@idea/ai-runtime/src/types';

export type CircuitState = 'closed' | 'open' | 'half-open';

type ProviderCircuit = {
  consecutiveFailures: number;
  state: CircuitState;
  openedAt: number;
  lastFailure: string | null;
};

export type ProviderCircuitBreaker = {
  /** Record a success — resets the circuit to closed */
  recordSuccess: (provider: Provider) => void;
  /** Record a failure — opens the circuit after threshold */
  recordFailure: (provider: Provider, error: string) => void;
  /** Check if provider should be skipped */
  isOpen: (provider: Provider) => boolean;
  /** Get ordered provider list: healthy first, open ones moved to end or removed */
  getProviderOrder: (preferred: Provider, allowFallback: boolean) => Provider[];
  /** Get circuit status for all providers (for AI health display) */
  getStatus: () => Record<Provider, { state: CircuitState; consecutiveFailures: number; lastFailure: string | null }>;
};

const DEFAULT_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

export const createProviderCircuitBreaker = (opts?: {
  threshold?: number;
  cooldownMs?: number;
}): ProviderCircuitBreaker => {
  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
  const cooldownMs = opts?.cooldownMs ?? DEFAULT_COOLDOWN_MS;

  const circuits: Record<Provider, ProviderCircuit> = {
    claude: { consecutiveFailures: 0, state: 'closed', openedAt: 0, lastFailure: null },
    codex: { consecutiveFailures: 0, state: 'closed', openedAt: 0, lastFailure: null },
  };

  const checkHalfOpen = (provider: Provider): void => {
    const c = circuits[provider];
    if (c.state === 'open' && Date.now() - c.openedAt >= cooldownMs) {
      c.state = 'half-open';
    }
  };

  return {
    recordSuccess(provider) {
      const c = circuits[provider];
      c.consecutiveFailures = 0;
      c.state = 'closed';
      c.lastFailure = null;
    },

    recordFailure(provider, error) {
      const c = circuits[provider];
      c.consecutiveFailures += 1;
      c.lastFailure = error;
      if (c.consecutiveFailures >= threshold && c.state === 'closed') {
        c.state = 'open';
        c.openedAt = Date.now();
      }
      // If half-open probe failed, go back to open
      if (c.state === 'half-open') {
        c.state = 'open';
        c.openedAt = Date.now();
      }
    },

    isOpen(provider) {
      checkHalfOpen(provider);
      return circuits[provider].state === 'open';
    },

    getProviderOrder(preferred, allowFallback) {
      const other: Provider = preferred === 'codex' ? 'claude' : 'codex';
      checkHalfOpen(preferred);
      checkHalfOpen(other);

      const preferredCircuit = circuits[preferred];
      const otherCircuit = circuits[other];

      // If preferred is open, swap to other (if available and not also open)
      if (preferredCircuit.state === 'open') {
        if (allowFallback && otherCircuit.state !== 'open') {
          return [other];
        }
        // Both open — try preferred anyway (half-open probe will happen via cooldown)
        return [preferred];
      }

      // If preferred is half-open, try it (probe) but have fallback ready
      if (preferredCircuit.state === 'half-open') {
        if (allowFallback) return [preferred, other];
        return [preferred];
      }

      // Normal: preferred first, then fallback if allowed
      if (allowFallback) return [preferred, other];
      return [preferred];
    },

    getStatus() {
      checkHalfOpen('claude');
      checkHalfOpen('codex');
      return {
        claude: {
          state: circuits.claude.state,
          consecutiveFailures: circuits.claude.consecutiveFailures,
          lastFailure: circuits.claude.lastFailure,
        },
        codex: {
          state: circuits.codex.state,
          consecutiveFailures: circuits.codex.consecutiveFailures,
          lastFailure: circuits.codex.lastFailure,
        },
      };
    },
  };
};
