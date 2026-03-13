export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function sortObject(value: Record<string, JsonValue>): Record<string, JsonValue> {
  const sorted: Record<string, JsonValue> = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    sorted[key] = stabilize(value[key]);
  }
  return sorted;
}

function stabilize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => stabilize(item));
  }
  if (value && typeof value === 'object') {
    return sortObject(value as Record<string, JsonValue>);
  }
  return value;
}

export function stableStringify(value: JsonValue): string {
  return JSON.stringify(stabilize(value));
}
