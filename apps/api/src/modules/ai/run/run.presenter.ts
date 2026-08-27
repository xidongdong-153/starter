import type {
  AgentRun,
  AgentRunLiveSnapshot,
  AgentRunSnapshot,
  ApiErrorCode,
  StarterRunData,
} from "@starter/contracts";
import { agentRunSnapshotSchema } from "@starter/contracts";

import { parseStoredJson } from "@api/shared/stored-json.js";
import type { AiAgentRunRecord } from "./run.repository.js";

/**
 * `live` 是进程内运行时视图，不是持久事实。
 * Run 进入终态或进程重启后为 null，客户端改读 transcript。
 */
export function toAgentRun(
  record: AiAgentRunRecord,
  live: AgentRunLiveSnapshot | null = null,
): AgentRun {
  const snapshot = parseSnapshot(record.snapshotJson);
  return {
    id: record.id,
    sessionId: record.sessionId,
    agentId: record.agentId,
    agentRevision: record.agentRevision,
    lane: record.lane,
    status: record.status as AgentRun["status"],
    snapshot,
    requestId: record.requestId,
    finalEntryId: record.finalEntryId,
    errorCode: record.errorCode as ApiErrorCode | null,
    createdAt: record.createdAt.toISOString(),
    startedAt: record.startedAt?.toISOString() ?? null,
    finishedAt: record.finishedAt?.toISOString() ?? null,
    live,
  };
}

export function toStarterRunData(input: {
  runId: string;
  sessionId: string;
  lane: string;
  agentId: string;
  agentRevision: number;
  status: "completed" | "failed" | "aborted";
  finalEntryId: string | null;
  errorCode: ApiErrorCode | null;
  finishedAt: Date;
}): StarterRunData {
  return {
    schemaVersion: 1,
    runId: input.runId,
    sessionId: input.sessionId,
    lane: input.lane,
    agentId: input.agentId,
    agentRevision: input.agentRevision,
    status: input.status,
    finalEntryId: input.finalEntryId,
    errorCode: input.errorCode,
    finishedAt: input.finishedAt.getTime(),
  };
}

function parseSnapshot(snapshotJson: string): AgentRunSnapshot {
  return parseStoredJson({
    column: "ai_agent_runs.snapshot_json",
    json: snapshotJson,
    schema: agentRunSnapshotSchema,
  });
}
