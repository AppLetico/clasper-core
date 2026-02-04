import { config, requireEnv } from "../core/config.js";

export type EmbeddingProviderType = "local" | "openai" | "none";

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

class LocalEmbeddingProvider implements EmbeddingProvider {
  private modelName: string;
  private extractor: ((input: string | string[], options?: Record<string, unknown>) => Promise<any>) | null = null;

  constructor(modelName: string) {
    this.modelName = modelName;
  }

  private async getExtractor() {
    if (this.extractor) return this.extractor;
    const { pipeline } = await import("@xenova/transformers");
    this.extractor = await pipeline("feature-extraction", this.modelName, { quantized: true });
    return this.extractor;
  }

  async embed(text: string): Promise<number[]> {
    const extractor = await this.getExtractor();
    const output = await extractor(text, { pooling: "mean", normalize: true });
    const data = (output?.data ?? output) as Float32Array | number[];
    return Array.from(data);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.getExtractor();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const data = (output?.data ?? output) as Float32Array[] | number[][];
    return data.map((row) => Array.from(row));
  }
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private modelName: string;

  constructor(modelName: string) {
    this.modelName = modelName;
  }

  async embed(text: string): Promise<number[]> {
    const [embedding] = await this.embedBatch([text]);
    return embedding ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    requireEnv("OPENAI_API_KEY", config.openaiApiKey);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openaiApiKey}`
      },
      body: JSON.stringify({
        model: this.modelName,
        input: texts
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI embeddings failed: ${response.status} ${errorText}`);
    }

    const payload = await response.json();
    return (payload.data || []).map((item: { embedding: number[] }) => item.embedding);
  }
}

let globalEmbeddingProvider: EmbeddingProvider | null | undefined = undefined;

export function getEmbeddingProvider(): EmbeddingProvider | null {
  if (globalEmbeddingProvider !== undefined) return globalEmbeddingProvider;

  const provider = (config.embeddingProvider || "none") as EmbeddingProviderType;
  if (provider === "none") {
    globalEmbeddingProvider = null;
    return globalEmbeddingProvider;
  }

  if (provider === "openai") {
    globalEmbeddingProvider = new OpenAIEmbeddingProvider(config.embeddingModel || "text-embedding-3-small");
    return globalEmbeddingProvider;
  }

  globalEmbeddingProvider = new LocalEmbeddingProvider(config.embeddingModel || "Xenova/all-MiniLM-L6-v2");
  return globalEmbeddingProvider;
}

export function resetEmbeddingProvider(): void {
  globalEmbeddingProvider = undefined;
}
