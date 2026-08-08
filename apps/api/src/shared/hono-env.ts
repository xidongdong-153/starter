import type { AppLogger } from "@api/infra/log/index.js";

export interface HonoEnv {
  Bindings: Record<string, never>;
  Variables: {
    currentUserId: string;
    logger: AppLogger;
    requestId: string;
    startedAt: number;
  };
}
