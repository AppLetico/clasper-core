export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_OVERLAP_CHARS = 200;

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = Math.max(0, options.overlapChars ?? DEFAULT_OVERLAP_CHARS);
  const cleaned = text.trim();
  if (!cleaned) return [];

  const paragraphs = cleaned.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) {
      chunks.push(current.trim());
    }
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      pushCurrent();
      for (let i = 0; i < paragraph.length; i += maxChars - overlapChars) {
        const slice = paragraph.slice(i, i + maxChars);
        if (slice.trim()) {
          chunks.push(slice.trim());
        }
      }
      continue;
    }

    const separator = current ? "\n\n" : "";
    if ((current + separator + paragraph).length <= maxChars) {
      current = current + separator + paragraph;
      continue;
    }

    pushCurrent();
    current = paragraph;
  }

  pushCurrent();
  return chunks;
}
