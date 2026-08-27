import type {
  AgentMessage,
  CompactionEntry,
  CustomEntry,
  Entry,
  Session,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import {
  createNodeSqliteFactory,
  SqliteSessionRepository,
} from "@earendil-works/pi-session-backend-sqlite-node";
import type { SqliteSessionMetadata } from "@earendil-works/pi-session-backend-sqlite-node";

/**
 * transcript 读取方向。`newestFirst` 下 `cursor.afterSeq` 取更早的 entry
 * （判据是 `entry.seq < afterSeq`），返回顺序也是从新到旧。
 */
export type TranscriptReadOrder = "oldestFirst" | "newestFirst";

export interface AgentSessionStore {
  createSession: (options?: { id?: string }) => Promise<AgentSessionHandle>;
  openSession: (sessionId: string) => Promise<AgentSessionHandle>;
  deleteSession: (sessionId: string) => Promise<void>;
  listSessions: () => Promise<string[]>;
  createLane: (options: {
    sessionId: string;
    lane: string;
    at?: string | null;
  }) => Promise<void>;
  readTranscript: (options: {
    sessionId: string;
    lane: string;
    cursor?: number;
    limit?: number;
    order?: TranscriptReadOrder;
  }) => Promise<Entry[]>;
  appendMessage: (options: {
    sessionId: string;
    lane: string;
    message: AgentMessage;
    id?: string;
  }) => Promise<Extract<Entry, { type: "message" }>>;
  appendCompaction: (options: {
    sessionId: string;
    lane: string;
    entry: Omit<CompactionEntry, "parentId" | "seq" | "timestamp">;
  }) => Promise<CompactionEntry>;
  appendRunTerminalEntry: (options: {
    sessionId: string;
    lane: string;
    data: unknown;
  }) => Promise<CustomEntry>;
  findRunTerminalEntries: (options: {
    sessionId: string;
    lane?: string;
    runId: string;
  }) => Promise<CustomEntry[]>;
  close: () => Promise<void>;
}

export interface AgentSessionHandle {
  readonly id: string;
  readonly metadata: SqliteSessionMetadata;
  readTranscript: (options?: {
    lane?: string;
    cursor?: number;
    limit?: number;
    order?: TranscriptReadOrder;
  }) => Promise<Entry[]>;
  appendMessage: (
    lane: string,
    message: AgentMessage,
    id?: string,
  ) => Promise<Extract<Entry, { type: "message" }>>;
  appendCompaction: (
    lane: string,
    entry: Omit<CompactionEntry, "parentId" | "seq" | "timestamp">,
  ) => Promise<CompactionEntry>;
  appendRunTerminalEntry: (lane: string, data: unknown) => Promise<CustomEntry>;
  createLane: (lane: string, at?: string | null) => Promise<void>;
  findRunTerminalEntries: (options: {
    lane?: string;
    runId: string;
  }) => Promise<CustomEntry[]>;
}

export interface PiSessionStoreOptions {
  databasePath: string;
  cwd: string;
}

export function createPiSessionStore(
  options: PiSessionStoreOptions,
): AgentSessionStore {
  const env = new NodeExecutionEnv({ cwd: options.cwd });
  const repository = new SqliteSessionRepository({
    env,
    sqlite: createNodeSqliteFactory(),
    databasePath: options.databasePath,
  });
  let closePromise: Promise<void> | undefined;

  async function metadataFor(
    sessionId: string,
  ): Promise<SqliteSessionMetadata> {
    const metadata = (await repository.list({ cwd: options.cwd })).find(
      (item) => item.id === sessionId,
    );
    if (!metadata) {
      throw new Error(`Pi Session 不存在: ${sessionId}`);
    }
    return metadata;
  }

  async function open(
    sessionId: string,
  ): Promise<Session<SqliteSessionMetadata>> {
    return repository.open(await metadataFor(sessionId));
  }

  function createHandle(
    session: Session<SqliteSessionMetadata>,
    metadata: SqliteSessionMetadata,
  ): AgentSessionHandle {
    return {
      id: metadata.id,
      metadata,
      readTranscript: (readOptions = {}) =>
        readTranscriptFromSession(session, readOptions),
      appendMessage: async (lane, message, id) =>
        appendMessageToSession(session, lane, message, id),
      appendCompaction: async (lane, entry) =>
        appendCompactionToSession(session, lane, entry),
      appendRunTerminalEntry: async (lane, data) =>
        appendTerminalToSession(session, lane, data),
      createLane: (lane, at = null) => session.createLane(lane, at),
      findRunTerminalEntries: (findOptions) =>
        findTerminalEntriesFromSession(session, findOptions),
    };
  }

  return {
    async createSession(createOptions = {}) {
      const session = await repository.create({
        ...(createOptions.id ? { id: createOptions.id } : {}),
        cwd: options.cwd,
      });
      return createHandle(session, await session.getMetadata());
    },

    async openSession(sessionId) {
      const metadata = await metadataFor(sessionId);
      return createHandle(await repository.open(metadata), metadata);
    },

    async deleteSession(sessionId) {
      await repository.delete(await metadataFor(sessionId));
    },

    async listSessions() {
      return (await repository.list({ cwd: options.cwd })).map(
        (item) => item.id,
      );
    },

    async createLane({ sessionId, lane, at = null }) {
      const session = await open(sessionId);
      await session.createLane(lane, at);
    },

    readTranscript: async ({ sessionId, lane, cursor, limit, order }) => {
      const session = await open(sessionId);
      return readTranscriptFromSession(session, { lane, cursor, limit, order });
    },

    appendMessage: async ({ sessionId, lane, message, id }) => {
      const session = await open(sessionId);
      return appendMessageToSession(session, lane, message, id);
    },

    appendCompaction: async ({ sessionId, lane, entry }) => {
      const session = await open(sessionId);
      return appendCompactionToSession(session, lane, entry);
    },

    appendRunTerminalEntry: async ({ sessionId, lane, data }) => {
      const session = await open(sessionId);
      return appendTerminalToSession(session, lane, data);
    },

    findRunTerminalEntries: async ({ sessionId, lane, runId }) => {
      const session = await open(sessionId);
      return findTerminalEntriesFromSession(session, { lane, runId });
    },

    close() {
      closePromise ??= (async () => {
        await repository.close();
        await env.cleanup();
      })();
      return closePromise;
    },
  };
}

async function readTranscriptFromSession(
  session: Session<SqliteSessionMetadata>,
  options: {
    lane?: string;
    cursor?: number;
    limit?: number;
    order?: TranscriptReadOrder;
  },
): Promise<Entry[]> {
  const lane = session.view(options.lane ?? "main");
  const leafId = await lane.getLeafId();
  if (!leafId) return [];
  return lane.findEntriesOnBranch({
    start: leafId,
    order: options.order ?? "oldestFirst",
    ...(options.cursor === undefined
      ? {}
      : { cursor: { afterSeq: options.cursor } }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
}

async function appendMessageToSession(
  session: Session<SqliteSessionMetadata>,
  lane: string,
  message: AgentMessage,
  id?: string,
): Promise<Extract<Entry, { type: "message" }>> {
  const entryId = id ?? (await session.view(lane).appendMessage(message));
  if (id !== undefined) {
    await session.appendEntry({ type: "message", id, message }, lane);
  }
  const entry = await session.getEntry(entryId);
  if (!entry || entry.type !== "message") {
    throw new Error(`Pi Session message entry 写入后无法读取: ${entryId}`);
  }
  return entry;
}

async function appendCompactionToSession(
  session: Session<SqliteSessionMetadata>,
  lane: string,
  entry: Omit<CompactionEntry, "parentId" | "seq" | "timestamp">,
): Promise<CompactionEntry> {
  return session.appendEntry(entry, lane);
}

async function appendTerminalToSession(
  session: Session<SqliteSessionMetadata>,
  lane: string,
  data: unknown,
): Promise<CustomEntry> {
  const id = await session.view(lane).appendCustomEntry("starter.run", data);
  const entry = await session.getEntry(id);
  if (!entry || entry.type !== "custom") {
    throw new Error(`Pi Session terminal entry 写入后无法读取: ${id}`);
  }
  return entry;
}

async function findTerminalEntriesFromSession(
  session: Session<SqliteSessionMetadata>,
  options: { lane?: string; runId: string },
): Promise<CustomEntry[]> {
  const lane = session.view(options.lane ?? "main");
  const leafId = await lane.getLeafId();
  if (!leafId) return [];
  const entries = await lane.findEntriesOnBranch({
    start: leafId,
    type: "custom",
    customType: "starter.run",
    order: "oldestFirst",
  });
  return entries.filter(
    (entry): entry is CustomEntry =>
      entry.type === "custom" &&
      isRecord(entry.data) &&
      entry.data.runId === options.runId,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
