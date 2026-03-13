import type { Skill } from "../skills/skills.js";

export type ContextSourceType = "skill" | "memory";

export interface ContextChunk {
  id: string;
  sourceType: ContextSourceType;
  sourceName: string;
  content: string;
  contentHash?: string;
}

export interface RankedChunk extends ContextChunk {
  score: number;
  rank: number;
}

export interface SelectedContext {
  skills: Skill[];
  memoryChunks: string[];
  chunkIds: string[];
}

export interface SmartContextOptions {
  maxSkills?: number;
  maxMemoryChunks?: number;
  forceIncludeSkills?: string[];
  tokenBudget?: number;
}
