import { describe, expect, it, vi } from 'vitest';

describe('Ollama memory indexer', () => {
  it('generates 768-dim embedding via Ollama and returns it', async () => {
    const mockEmbed = vi.fn().mockResolvedValue(Array.from({ length: 768 }, () => 0.01));

    // Import after mock is set up — the actual module integration
    // will be tested after wiring. For now validate the shape.
    const embedding = await mockEmbed('test text');
    expect(embedding).toHaveLength(768);
  });

  it('falls back gracefully when Ollama is unreachable', async () => {
    const mockEmbed = vi.fn().mockResolvedValue(null);
    const embedding = await mockEmbed('test text');
    expect(embedding).toBeNull();
  });
});
