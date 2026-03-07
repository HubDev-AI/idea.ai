import type { ThesisDraft, ThesisStatus } from '../jobs/thesis_synthesizer';

export type ThesisStoreFilter = {
  status?: ThesisStatus;
};

export interface ThesisStore {
  upsert(draft: ThesisDraft): Promise<void>;
  list(filter?: ThesisStoreFilter): Promise<ThesisDraft[]>;
  getByKey(canonicalKey: string): Promise<ThesisDraft | null>;
  setLabel?(canonicalKey: string, label: 'favourite' | 'later' | 'dismissed' | null): Promise<{ label: string | null } | null>;
  bayesianUpdate?(canonicalKey: string, confidenceDelta: number): Promise<void>;
}

export class InMemoryThesisStore implements ThesisStore {
  private store = new Map<string, ThesisDraft>();

  async upsert(draft: ThesisDraft): Promise<void> {
    this.store.set(draft.canonicalKey, { ...draft });
  }

  async list(filter?: ThesisStoreFilter): Promise<ThesisDraft[]> {
    const sorted = Array.from(this.store.values()).sort((a, b) => b.confidence - a.confidence);
    if (filter?.status) {
      return sorted.filter((t) => t.status === filter.status);
    }
    return sorted;
  }

  async getByKey(canonicalKey: string): Promise<ThesisDraft | null> {
    return this.store.get(canonicalKey) ?? null;
  }

  async setLabel(canonicalKey: string, label: 'favourite' | 'later' | 'dismissed' | null): Promise<{ label: string | null } | null> {
    const draft = this.store.get(canonicalKey);
    if (!draft) return null;
    draft.label = label;
    return { label };
  }
}
