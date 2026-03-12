import type { ThesisDraft, ThesisStatus } from '../jobs/thesis_synthesizer';

export type ThesisStoreFilter = {
  status?: ThesisStatus;
  profileId?: string;
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
    const existing = this.store.get(draft.canonicalKey);
    this.store.set(draft.canonicalKey, {
      ...draft,
      firstObservedAt: existing?.firstObservedAt ?? draft.firstObservedAt ?? draft.latestObservedAt,
    });
  }

  async list(filter?: ThesisStoreFilter): Promise<ThesisDraft[]> {
    const sorted = Array.from(this.store.values()).sort((a, b) => b.confidence - a.confidence);
    return sorted.filter((t) => {
      if (filter?.status && t.status !== filter.status) return false;
      if (filter?.profileId && (t.profileId ?? 'consumer') !== filter.profileId) return false;
      return true;
    });
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
