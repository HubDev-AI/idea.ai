import { describe, expect, it } from 'vitest';
import { estimateSupply, classifyImbalance, imbalanceMultiplier, type SupplyEstimate } from '../src/scoring/supply_demand';

describe('estimateSupply', () => {
  it('computes maturity from product and repo counts', () => {
    const result = estimateSupply({ existingProducts: 2, githubRepos: 5, fundedCompanies: 1 });
    expect(result.maturityLevel).toBe('growing');
    expect(result.totalSupply).toBe(8);
  });

  it('nascent for zero supply', () => {
    const result = estimateSupply({ existingProducts: 0, githubRepos: 0, fundedCompanies: 0 });
    expect(result.maturityLevel).toBe('nascent');
  });

  it('saturated for very high supply', () => {
    const result = estimateSupply({ existingProducts: 50, githubRepos: 100, fundedCompanies: 20 });
    expect(result.maturityLevel).toBe('saturated');
  });
});

describe('classifyImbalance', () => {
  it('opportunity when high demand, low supply', () => {
    expect(classifyImbalance({ demandSignals: 20, totalSupply: 2 })).toBe('opportunity');
  });

  it('competitive when both high', () => {
    expect(classifyImbalance({ demandSignals: 20, totalSupply: 25 })).toBe('competitive');
  });

  it('niche when both low', () => {
    expect(classifyImbalance({ demandSignals: 2, totalSupply: 1 })).toBe('niche');
  });

  it('saturated when low demand, high supply', () => {
    expect(classifyImbalance({ demandSignals: 3, totalSupply: 30 })).toBe('saturated');
  });
});

describe('imbalanceMultiplier', () => {
  it('boosts opportunity', () => {
    expect(imbalanceMultiplier('opportunity')).toBe(1.5);
  });

  it('neutral for competitive', () => {
    expect(imbalanceMultiplier('competitive')).toBe(1.0);
  });

  it('penalizes niche', () => {
    expect(imbalanceMultiplier('niche')).toBe(0.7);
  });

  it('penalizes saturated', () => {
    expect(imbalanceMultiplier('saturated')).toBe(0.4);
  });
});
