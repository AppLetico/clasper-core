import { config } from "../core/config.js";
import { getEmbeddingProvider } from "./embeddingProvider.js";
import { getVectorStore } from "./vectorStore.js";
import { getWorkspaceIndex } from "./workspaceIndex.js";

export { ContextSelector, getContextSelector, resetContextSelector } from "./contextSelector.js";
export { getEmbeddingProvider, resetEmbeddingProvider } from "./embeddingProvider.js";
export { getVectorStore, resetVectorStore } from "./vectorStore.js";
export { getWorkspaceIndex, resetWorkspaceIndex } from "./workspaceIndex.js";
export * from "./types.js";

export async function reindexWorkspace(): Promise<{
  indexedChunks: number;
  indexedSkills: number;
  indexedMemoryChunks: number;
  lastIndexedAt: string | null;
  embeddingProvider: string;
}> {
  const index = getWorkspaceIndex();
  const stats = index.indexWorkspace();
  const embedder = getEmbeddingProvider();
  if (embedder) {
    const vectorStore = getVectorStore();
    vectorStore.clear();
    const chunks = index.getAllChunks();
    if (chunks.length > 0) {
      const embeddings = await embedder.embedBatch(chunks.map((chunk) => chunk.content));
      vectorStore.upsertEmbeddings(
        chunks.map((chunk, idx) => ({
          chunkId: chunk.id,
          sourceType: chunk.sourceType,
          sourceName: chunk.sourceName,
          embedding: embeddings[idx] || [],
          contentHash: chunk.contentHash || ""
        }))
      );
    }
  }

  return {
    ...stats,
    embeddingProvider: config.embeddingProvider || "none"
  };
}
