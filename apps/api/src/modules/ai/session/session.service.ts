import type { Logger } from "pino";
import type {
  AgentSession,
  AgentSessionListQuery,
  AgentTranscript,
  AgentTranscriptQuery,
  CreateAgentSessionInput,
  UpdateAgentSessionInput,
} from "@starter/contracts";
import { ApiErrorCodes } from "@starter/contracts";

import type { AgentSessionStore } from "@api/infra/agent/index.js";
import { AppError } from "@api/shared/app-error.js";
import { generateId } from "@api/shared/id.js";

import { projectTranscript, toAgentSession } from "./session.presenter.js";
import type { AiAgentSessionRepository } from "./session.repository.js";

export interface SessionConsistencyReport {
  missingInPi: string[];
  missingInMain: string[];
}

export interface AiAgentSessionService {
  create: (
    input: CreateAgentSessionInput,
    ownerId: string,
    requestId?: string,
  ) => Promise<AgentSession>;
  list: (
    ownerId: string,
    query: AgentSessionListQuery,
  ) => {
    items: AgentSession[];
    total: number;
    page: number;
    pageSize: number;
  };
  get: (ownerId: string, sessionId: string) => AgentSession;
  update: (
    ownerId: string,
    sessionId: string,
    input: UpdateAgentSessionInput,
  ) => Promise<AgentSession>;
  archive: (ownerId: string, sessionId: string) => AgentSession;
  transcript: (
    ownerId: string,
    sessionId: string,
    query: AgentTranscriptQuery,
    requestId?: string,
  ) => Promise<AgentTranscript>;
  checkConsistency: () => Promise<SessionConsistencyReport>;
}

export function createAiAgentSessionService(input: {
  repository: AiAgentSessionRepository;
  sessionStore: AgentSessionStore;
  logger: Logger;
}): AiAgentSessionService {
  const { repository, sessionStore, logger } = input;

  async function assertDefaultAgent(id: string | null): Promise<void> {
    if (id === null) return;
    const status = repository.findDefaultAgentStatus(id);
    if (status === "missing") {
      throw new AppError(
        ApiErrorCodes.COMMON_INVALID_REQUEST,
        "defaultAgentId 引用的 Agent 不存在",
        400,
      );
    }
    if (status !== "enabled") {
      throw new AppError(
        ApiErrorCodes.AI_AGENT_NOT_ENABLED,
        "defaultAgentId 必须引用已启用的 Agent",
        409,
      );
    }
  }

  function requireActiveSession(ownerId: string, sessionId: string) {
    const record = repository.findOwned(sessionId, ownerId);
    if (!record || record.archivedAt !== null) throw notFound();
    return record;
  }

  function notFound(): AppError {
    return new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "资源不存在", 404);
  }

  async function create(
    input: CreateAgentSessionInput,
    ownerId: string,
    requestId?: string,
  ): Promise<AgentSession> {
    const title = input.title ?? "新会话";
    const defaultAgentId = input.defaultAgentId ?? null;
    await assertDefaultAgent(defaultAgentId);

    const id = generateId();
    try {
      await sessionStore.createSession({ id });
    } catch (cause) {
      logger.error(
        { err: cause, sessionId: id, requestId },
        "Agent Session 创建失败",
      );
      throw new AppError(
        ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
        "Agent Session 创建失败",
        500,
      );
    }

    try {
      const record = repository.create({
        id,
        ownerId,
        title,
        defaultAgentId,
        now: new Date(),
      });
      return toAgentSession(record);
    } catch (cause) {
      try {
        await sessionStore.deleteSession(id);
      } catch (deleteError) {
        logger.error(
          {
            err: deleteError,
            sessionId: id,
            requestId,
          },
          "Agent Session 创建补偿删除失败，存在孤儿 Pi Session",
        );
      }
      logger.error(
        { err: cause, sessionId: id, requestId },
        "Agent Session 主库索引写入失败",
      );
      throw new AppError(
        ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
        "创建 Agent Session 失败",
        500,
      );
    }
  }

  function list(
    ownerId: string,
    query: AgentSessionListQuery,
  ): {
    items: AgentSession[];
    total: number;
    page: number;
    pageSize: number;
  } {
    const result = repository.listOwnedActive(
      ownerId,
      query.page,
      query.pageSize,
    );
    return {
      items: result.items.map(toAgentSession),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  function get(ownerId: string, sessionId: string): AgentSession {
    return toAgentSession(requireActiveSession(ownerId, sessionId));
  }

  async function update(
    ownerId: string,
    sessionId: string,
    input: UpdateAgentSessionInput,
  ): Promise<AgentSession> {
    // 先确认资源存在且未归档（不存在/他人/已归档统一 404），再校验输入
    requireActiveSession(ownerId, sessionId);
    if (input.defaultAgentId !== undefined) {
      await assertDefaultAgent(input.defaultAgentId);
    }
    const record = repository.updateOwned({
      id: sessionId,
      ownerId,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.defaultAgentId !== undefined
        ? { defaultAgentId: input.defaultAgentId }
        : {}),
      now: new Date(),
    });
    if (!record) throw notFound();
    return toAgentSession(record);
  }

  function archive(ownerId: string, sessionId: string): AgentSession {
    const result = repository.archiveOwned(sessionId, ownerId, new Date());
    if (result.status === "not_found") throw notFound();
    return toAgentSession(result.record);
  }

  async function transcript(
    ownerId: string,
    sessionId: string,
    query: AgentTranscriptQuery,
    requestId?: string,
  ): Promise<AgentTranscript> {
    requireActiveSession(ownerId, sessionId);

    const backward = query.direction === "backward";
    let entries;
    try {
      entries = await sessionStore.readTranscript({
        sessionId,
        lane: query.lane,
        cursor: query.cursor,
        limit: query.limit + 1,
        order: backward ? "newestFirst" : "oldestFirst",
      });
    } catch (cause) {
      logger.error(
        { err: cause, sessionId, requestId },
        "Agent Session transcript 读取失败",
      );
      throw new AppError(
        ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
        "Agent Session 读取失败",
        500,
      );
    }

    // hasMore 只看多读的那一条 raw entry 是否存在，与投影后的 item 数量无关。
    const hasMore = entries.length > query.limit;
    const pageEntries = hasMore ? entries.slice(0, query.limit) : entries;
    // backward 读到的是从新到旧，投影前先反转成时间正序。
    const visibleEntries = backward ? [...pageEntries].reverse() : pageEntries;
    const items = projectTranscript(visibleEntries, query.lane, (info) => {
      logger.warn(
        { ...info, sessionId, requestId },
        "Agent transcript 跳过不可投影 entry",
      );
    });

    // backward 的 nextCursor 指向本页最早一条 raw entry，用来继续往更早翻；
    // forward 指向本页最后一条，用来继续往更新翻。
    const cursorEntry = backward
      ? visibleEntries[0]
      : visibleEntries[visibleEntries.length - 1];
    const nextCursor =
      hasMore && cursorEntry !== undefined ? cursorEntry.seq : null;
    return { items, nextCursor };
  }

  async function checkConsistency(): Promise<SessionConsistencyReport> {
    const mainIds = new Set(repository.listAllIds());
    let piIds: string[];
    try {
      piIds = await sessionStore.listSessions();
    } catch (cause) {
      logger.error(
        { err: cause },
        "Agent Session 一致性检查读取 Pi metadata 失败",
      );
      throw new AppError(
        ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
        "Agent Session 读取失败",
        500,
      );
    }
    const piIdSet = new Set(piIds);
    const missingInPi = [...mainIds].filter((id) => !piIdSet.has(id));
    const missingInMain = piIds.filter((id) => !mainIds.has(id));
    return { missingInPi, missingInMain };
  }

  return {
    create,
    list,
    get,
    update,
    archive,
    transcript,
    checkConsistency,
  };
}
