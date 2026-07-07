// Rough published list prices (USD per 1,000,000 tokens) for well-known cloud models, used only
// to estimate spend for the optional daily budget feature. These are NOT live prices — check your
// provider's own billing dashboard for what you're actually charged. Local Ollama models aren't
// listed here on purpose: estimateCostUsd returns undefined for them, since they cost nothing.
interface Price {
  input: number;
  output: number;
}

const PRICES: Record<string, Price> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1-mini': { input: 1.1, output: 4.4 },
  o1: { input: 15, output: 60 },
};

/** Returns an estimated USD cost for a request, or undefined if the model isn't recognized. */
export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number | undefined {
  const lower = model.toLowerCase();
  // Longest key first so e.g. "gpt-4o-mini" matches before the shorter "gpt-4o".
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => lower.includes(k));
  if (!key) return undefined;
  const p = PRICES[key];
  return (promptTokens / 1_000_000) * p.input + (completionTokens / 1_000_000) * p.output;
}
