export type OllamaEmbedResponse = {
  embedding: number[];
};

export type EmbedOptions = {
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  fallbackToNull?: boolean;
};

export const embedText = async (
  text: string,
  options: EmbedOptions = {}
): Promise<number[] | null> => {
  const model = options.model ?? 'nomic-embed-text';
  const baseUrl = options.baseUrl ?? 'http://localhost:11434';
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text })
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed (${response.status})`);
    }

    const data = (await response.json()) as OllamaEmbedResponse;
    return data.embedding;
  } catch (error) {
    if (options.fallbackToNull) {
      return null;
    }
    throw error;
  }
};

export const embedBatch = async (
  texts: string[],
  options: EmbedOptions = {}
): Promise<(number[] | null)[]> => {
  return Promise.all(texts.map((text) => embedText(text, { ...options, fallbackToNull: true })));
};
