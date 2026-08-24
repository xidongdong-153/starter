const DEFAULT_MAX_JSON_DEPTH = 16;

export function parseBoundedJson(
  json: string,
  maxDepth = DEFAULT_MAX_JSON_DEPTH,
): unknown {
  const value = JSON.parse(json) as unknown;
  assertJsonDepth(value, maxDepth);
  return value;
}

export function assertJsonDepth(
  value: unknown,
  maxDepth = DEFAULT_MAX_JSON_DEPTH,
): void {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 1 },
  ];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > maxDepth) throw new Error("JSON exceeds maximum depth");
    if (Array.isArray(current.value)) {
      for (const item of current.value)
        pending.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (typeof current.value === "object" && current.value !== null) {
      for (const item of Object.values(current.value))
        pending.push({ value: item, depth: current.depth + 1 });
    }
  }
}
