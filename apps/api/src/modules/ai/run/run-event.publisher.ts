import type { RunEvent } from "@starter/contracts";

import type { AsyncEventQueue } from "@api/infra/agent/pi-event-mapper.js";
import type {
  AiRunEventRepository,
  RunEventDraft,
} from "./run-event.repository.js";

export interface RunEventSink {
  push: (event: RunEvent) => void;
}

export interface RunEventPublisherOptions {
  repository: AiRunEventRepository;
  sink?: RunEventSink;
  queue?: AsyncEventQueue<RunEvent>;
  onPersisted?: (event: RunEvent) => void;
  /** 持久化失败时的确定出口：调用方把 Run 转入存储失败终态并停止 transport。 */
  onStorageFailure?: (error: unknown) => void;
}

/** 增量合并窗口：同一 part 的增量最多攒 250 毫秒。 */
export const RUN_EVENT_MERGE_WINDOW_MS = 250;
/** 增量合并上限：同一 part 的增量最多攒 1024 字节（1KB）。 */
export const RUN_EVENT_MERGE_MAX_BYTES = 1024;

/** 可合并事件：文本增量按字节累加，Tool 进度按最新状态覆盖。 */
type MergeableDraft = Extract<
  RunEventDraft,
  { type: "message.delta" | "tool.progress" }
>;

interface PendingMerge {
  key: string;
  draft: MergeableDraft;
  bytes: number;
  timer: ReturnType<typeof setTimeout>;
}

function isMergeable(draft: RunEventDraft): draft is MergeableDraft {
  return draft.type === "message.delta" || draft.type === "tool.progress";
}

function mergeKey(draft: MergeableDraft): string {
  return draft.type === "message.delta"
    ? `message.delta:${draft.data.partId}`
    : `tool.progress:${draft.toolCallId ?? ""}`;
}

function mergeBytes(draft: MergeableDraft): number {
  return Buffer.byteLength(
    draft.type === "message.delta" ? draft.data.delta : draft.data.summary,
    "utf8",
  );
}

/**
 * 产品事件唯一发布入口：先写时间线，再更新实时投影并广播。
 *
 * `message.delta` 和 `tool.progress` 先在这里按 250ms / 1KB 合并成一个事件，
 * 再分配 sequence、持久化、进实时队列，所以 SQLite 行数不随 Provider token 数增长。
 * 任何非合并事件、终态和 `close()` 都会先把待合并缓冲刷出，事件相对顺序不变。
 */
export class RunEventPublisher {
  private readonly repository: AiRunEventRepository;
  private readonly sink: RunEventSink;
  private readonly onPersisted?: (event: RunEvent) => void;
  private readonly onStorageFailure?: (error: unknown) => void;
  private pending: PendingMerge | null = null;
  private storageFailed = false;

  constructor(options: RunEventPublisherOptions) {
    this.repository = options.repository;
    this.sink = options.sink ?? options.queue ?? { push: () => undefined };
    this.onPersisted = options.onPersisted;
    this.onStorageFailure = options.onStorageFailure;
  }

  /**
   * 发布一个事件草稿。
   *
   * 返回已持久化的事件；进入合并缓冲时返回 `null`，事件会在阈值到达、
   * 下一个非合并事件或 `flush()` 时落库。持久化失败时抛出，同时把 Run
   * 标成存储失败，之后不再发布任何事件，避免制造 sequence 空洞。
   */
  publish(draft: RunEventDraft): RunEvent | null {
    if (this.storageFailed) return null;
    if (isMergeable(draft)) return this.mergeOrPersist(draft);
    this.flush();
    if (this.storageFailed) return null;
    return this.persist(draft);
  }

  /** 把待合并缓冲立即落库；消息结束、Tool 结束、Turn 结束和终态事务前必须调用。 */
  flush(): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    if (this.storageFailed) return;
    this.persist(pending.draft);
  }

  /** 已经在终态事务里落库的事件：只更新投影并广播，不再分配 sequence。 */
  publishPersisted(event: RunEvent): void {
    this.onPersisted?.(event);
    this.sink.push(event);
  }

  /** Run 终态或队列关闭时调用：清掉合并定时器，不留悬挂 timer。 */
  close(): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending = null;
  }

  listAfter(runId: string, afterSequence: number, limit: number): RunEvent[] {
    return this.repository.listAfter(runId, afterSequence, limit);
  }

  private mergeOrPersist(draft: MergeableDraft): RunEvent | null {
    const key = mergeKey(draft);
    const bytes = mergeBytes(draft);
    const pending = this.pending;
    if (pending && pending.key === key) {
      // 合并后会超过 1KB 上限时先刷旧的，保证单个事件的增量不超上限。
      if (pending.bytes + bytes <= RUN_EVENT_MERGE_MAX_BYTES) {
        pending.draft = mergeDraft(pending.draft, draft);
        pending.bytes += bytes;
        if (pending.bytes < RUN_EVENT_MERGE_MAX_BYTES) return null;
        this.flush();
        return null;
      }
    }
    this.flush();
    if (this.storageFailed) return null;
    // 单条增量本身就撞上限时不再缓冲，直接落库。
    if (bytes >= RUN_EVENT_MERGE_MAX_BYTES) return this.persist(draft);
    this.pending = {
      key,
      draft,
      bytes,
      timer: setTimeout(() => this.flushOnTimer(), RUN_EVENT_MERGE_WINDOW_MS),
    };
    return null;
  }

  private flushOnTimer(): void {
    try {
      this.flush();
    } catch {
      // persist 已经上报存储失败，定时器路径不再抛出。
    }
  }

  private persist(draft: RunEventDraft): RunEvent {
    let event: RunEvent;
    try {
      event = this.repository.append(draft);
    } catch (error) {
      // 写库失败就停在这里：不广播这个事件，Run 转入存储失败终态。
      this.storageFailed = true;
      this.close();
      this.onStorageFailure?.(error);
      throw error;
    }
    this.onPersisted?.(event);
    this.sink.push(event);
    return event;
  }
}

function mergeDraft(
  pending: MergeableDraft,
  next: MergeableDraft,
): MergeableDraft {
  if (pending.type === "message.delta" && next.type === "message.delta") {
    return {
      ...pending,
      data: {
        partId: pending.data.partId,
        delta: pending.data.delta + next.data.delta,
      },
    };
  }
  // Tool 进度是状态而不是增量，合并后只保留最新摘要。
  return next;
}
