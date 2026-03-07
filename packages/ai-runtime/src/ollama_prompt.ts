export type OllamaPromptOptions = {
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export const runOllamaPrompt = async (
  prompt: string,
  options: OllamaPromptOptions = {}
): Promise<string> => {
  const model = options.model ?? 'llama3.2:3b';
  const baseUrl = options.baseUrl ?? 'http://localhost:11434';
  const timeoutMs = options.timeoutMs ?? 30_000;
  const fetchFn = options.fetchImpl ?? fetch;

  const res = await fetchFn(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = (await res.json()) as { response: string };
  return data.response;
};
