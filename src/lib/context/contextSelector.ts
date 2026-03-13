import { config } from "../core/config.js";
import { SkillsLoader, type Skill } from "../skills/skills.js";
import { getEmbeddingProvider } from "./embeddingProvider.js";
import { getVectorStore } from "./vectorStore.js";
import { getWorkspaceIndex, WorkspaceIndex } from "./workspaceIndex.js";
import type { RankedChunk, ContextChunk, SmartContextOptions, SelectedContext } from "./types.js";

const RRF_K = 60;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function reciprocalRankFusion(
  keywordResults: ContextChunk[],
  vectorResults: { chunkId: string; score: number; sourceType: string; sourceName: string; contentHash?: string }[]
): RankedChunk[] {
  const scores = new Map<string, { score: number; chunk: ContextChunk }>();

  keywordResults.forEach((chunk, index) => {
    const rankScore = 1 / (RRF_K + index + 1);
    scores.set(chunk.id, { score: rankScore, chunk });
  });

  vectorResults.forEach((item, index) => {
    const rankScore = 1 / (RRF_K + index + 1);
    const existing = scores.get(item.chunkId);
    if (existing) {
      existing.score += rankScore;
      return;
    }
    scores.set(item.chunkId, {
      score: rankScore,
      chunk: {
        id: item.chunkId,
        sourceType: item.sourceType as any,
        sourceName: item.sourceName,
        content: "",
        contentHash: item.contentHash
      }
    });
  });

  const ranked = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((entry, index) => ({
      ...entry.chunk,
      score: entry.score,
      rank: index + 1
    }));

  return ranked;
}

function buildSkillMap(skills: Skill[]): Map<string, Skill> {
  const map = new Map<string, Skill>();
  skills.forEach((skill) => map.set(skill.name, skill));
  return map;
}

export class ContextSelector {
  private skillsLoader: SkillsLoader;
  private workspaceIndex: WorkspaceIndex;

  constructor(workspacePath?: string) {
    this.skillsLoader = new SkillsLoader(workspacePath);
    this.workspaceIndex = workspacePath ? new WorkspaceIndex(workspacePath) : getWorkspaceIndex();
  }

  async selectContext(query: string, options: SmartContextOptions = {}): Promise<SelectedContext> {
    const maxSkills = options.maxSkills ?? config.smartContextMaxSkills;
    const maxMemoryChunks = options.maxMemoryChunks ?? config.smartContextMaxMemoryChunks;
    const tokenBudget = options.tokenBudget && options.tokenBudget > 0 ? options.tokenBudget : null;
    const forceIncludeSkills = options.forceIncludeSkills ?? [];

    const index = this.workspaceIndex;
    const indexStats = index.getStats();
    if (!indexStats.lastIndexedAt) {
      index.indexWorkspace();
    }

    const keywordResults = index.searchKeyword(query, 30);
    let vectorResults: Array<{ chunkId: string; score: number; sourceType: string; sourceName: string; contentHash?: string }> = [];

    const embedder = getEmbeddingProvider();
    if (embedder) {
      const vectorStore = getVectorStore();
      const storedEmbeddings = vectorStore.getEmbeddings();
      if (storedEmbeddings.length === 0) {
        const allChunks = index.getAllChunks();
        if (allChunks.length > 0) {
          const embeddings = await embedder.embedBatch(allChunks.map((chunk) => chunk.content));
          vectorStore.upsertEmbeddings(
            allChunks.map((chunk, index) => ({
              chunkId: chunk.id,
              sourceType: chunk.sourceType,
              sourceName: chunk.sourceName,
              embedding: embeddings[index] || [],
              contentHash: chunk.contentHash || ""
            }))
          );
        }
      }

      const queryEmbedding = await embedder.embed(query);
      vectorResults = vectorStore.search(queryEmbedding, 30);
    }

    const ranked = reciprocalRankFusion(keywordResults, vectorResults);
    const rankedChunks = this.hydrateContentIfMissing(ranked, index);

    const enabledSkills = this.skillsLoader.getEnabledSkills();
    const skillMap = buildSkillMap(enabledSkills);
    const alwaysSkills = enabledSkills.filter((skill) => skill.metadata?.openclaw?.always);

    const selectedSkillNames = new Set<string>([
      ...alwaysSkills.map((skill) => skill.name),
      ...forceIncludeSkills
    ]);

    for (const chunk of rankedChunks) {
      if (chunk.sourceType !== "skill") continue;
      if (selectedSkillNames.has(chunk.sourceName)) continue;
      if (selectedSkillNames.size - alwaysSkills.length - forceIncludeSkills.length >= maxSkills) {
        break;
      }
      selectedSkillNames.add(chunk.sourceName);
    }

    const rankedMemoryChunks = rankedChunks.filter((chunk) => chunk.sourceType === "memory");
    const selectedMemoryChunks: string[] = [];
    for (const chunk of rankedMemoryChunks) {
      if (selectedMemoryChunks.length >= maxMemoryChunks) break;
      selectedMemoryChunks.push(chunk.content);
    }

    let selectedSkills = Array.from(selectedSkillNames)
      .map((name) => skillMap.get(name))
      .filter((skill): skill is Skill => Boolean(skill));

    if (tokenBudget !== null) {
      const trimmed = this.trimToTokenBudget(
        selectedSkills,
        selectedMemoryChunks,
        tokenBudget,
        alwaysSkills.map((skill) => skill.name),
        forceIncludeSkills
      );
      selectedSkills = trimmed.skills;
      selectedMemoryChunks.length = 0;
      selectedMemoryChunks.push(...trimmed.memoryChunks);
    }

    return {
      skills: selectedSkills,
      memoryChunks: selectedMemoryChunks,
      chunkIds: rankedChunks.map((chunk) => chunk.id)
    };
  }

  private hydrateContentIfMissing(ranked: RankedChunk[], index: WorkspaceIndex): RankedChunk[] {
    const missingIds = ranked.filter((chunk) => !chunk.content).map((chunk) => chunk.id);
    if (missingIds.length === 0) return ranked;

    const fetched = index.getChunksByIds(missingIds);
    const fetchedMap = new Map(fetched.map((chunk) => [chunk.id, chunk]));
    return ranked.map((chunk) => {
      if (chunk.content) return chunk;
      const fetchedChunk = fetchedMap.get(chunk.id);
      if (!fetchedChunk) return chunk;
      return {
        ...chunk,
        content: fetchedChunk.content,
        contentHash: fetchedChunk.contentHash
      };
    });
  }

  private trimToTokenBudget(
    skills: Skill[],
    memoryChunks: string[],
    tokenBudget: number,
    alwaysSkills: string[],
    forcedSkills: string[]
  ): { skills: Skill[]; memoryChunks: string[] } {
    let remaining = tokenBudget;
    const keepSkillNames = new Set<string>([...alwaysSkills, ...forcedSkills]);
    const orderedSkills = [...skills].sort((a, b) => {
      const aForced = keepSkillNames.has(a.name) ? 0 : 1;
      const bForced = keepSkillNames.has(b.name) ? 0 : 1;
      return aForced - bForced;
    });

    const selectedSkills: Skill[] = [];
    for (const skill of orderedSkills) {
      const cost = estimateTokens(skill.instructions || "");
      if (keepSkillNames.has(skill.name) || remaining - cost >= 0) {
        selectedSkills.push(skill);
        remaining -= cost;
      }
    }

    const selectedMemoryChunks: string[] = [];
    for (const chunk of memoryChunks) {
      const cost = estimateTokens(chunk);
      if (remaining - cost < 0) break;
      selectedMemoryChunks.push(chunk);
      remaining -= cost;
    }

    return { skills: selectedSkills, memoryChunks: selectedMemoryChunks };
  }
}

let globalContextSelector: ContextSelector | null = null;

export function getContextSelector(): ContextSelector {
  if (!globalContextSelector) {
    globalContextSelector = new ContextSelector();
  }
  return globalContextSelector;
}

export function resetContextSelector(): void {
  globalContextSelector = null;
}
