import type { ApiMeta } from "@starter/contracts";

export function createMeta(requestId: string = crypto.randomUUID()): ApiMeta {
  return {
    requestId,
    timestamp: new Date().toISOString(),
  };
}
