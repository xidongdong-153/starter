import type { AgentRunLiveSnapshot, HarnessEvent } from "@starter/contracts";

/** 快照里保留的 message 与 tool 上限，防止长 Run 的内存无界增长；超限丢最旧的。 */
const MAX_SNAPSHOT_ITEMS = 64;

interface LiveMessage {
  messageId: string;
  content: string;
  completed: boolean;
}

interface LiveTool {
  toolCallId: string;
  name: string;
  status: AgentRunLiveSnapshot["tools"][number]["status"];
  safeSummary: string | null;
}

/**
 * 活跃 Run 的进程内快照状态。
 *
 * 它是流式视图的服务端副本，不是持久事实：Run 进终态后由 Run Service 丢弃，
 * 客户端改从 transcript 读取。折叠规则与 `apps/admin/src/features/ai/harness/stream-reducer.ts`
 * 保持同构，保证刷新页面前后看到的内容一致。
 */
export interface RunLiveSnapshotState {
  lastSequence: number;
  turn: number;
  maxTurns: number;
  messages: LiveMessage[];
  tools: LiveTool[];
}

export function createRunLiveSnapshot(maxTurns: number): RunLiveSnapshotState {
  return {
    lastSequence: 0,
    turn: 0,
    maxTurns,
    messages: [],
    tools: [],
  };
}

/**
 * 把一个已发布的 HarnessEvent 折叠进快照。就地更新，不返回新对象。
 *
 * sequence 不递增的事件直接忽略，与前端 reducer 的去重规则一致。
 */
export function applyRunEvent(
  state: RunLiveSnapshotState,
  event: HarnessEvent,
): void {
  if (event.sequence <= state.lastSequence) return;
  state.lastSequence = event.sequence;

  switch (event.type) {
    case "turn.started":
      state.turn = event.data.turn;
      break;
    case "message.started":
      pushCapped(state.messages, {
        messageId: event.data.messageId,
        content: "",
        completed: false,
      });
      break;
    case "message.delta": {
      const message = state.messages.find(
        (item) => item.messageId === event.data.messageId,
      );
      if (message) message.content += event.data.delta;
      break;
    }
    case "message.completed": {
      const message = state.messages.find(
        (item) => item.messageId === event.data.messageId,
      );
      if (message) {
        message.content = event.data.content;
        message.completed = true;
      }
      break;
    }
    case "tool.started":
      upsertTool(state, event.data.toolCallId, event.data.name).status =
        "running";
      break;
    case "tool.progress":
      upsertTool(state, event.data.toolCallId, event.data.name).safeSummary =
        event.data.safeSummary;
      break;
    case "tool.completed": {
      const tool = upsertTool(state, event.data.toolCallId, event.data.name);
      tool.status = event.data.status;
      tool.safeSummary = event.data.safeSummary;
      break;
    }
    default:
      // run.started / turn.completed / context.compacted / terminal 事件
      // 不改变快照内容，只推进 lastSequence。
      break;
  }
}

export function toAgentRunLiveSnapshot(
  state: RunLiveSnapshotState,
): AgentRunLiveSnapshot {
  return {
    lastSequence: state.lastSequence,
    turn: state.turn,
    maxTurns: state.maxTurns,
    messages: state.messages.map((message) => ({ ...message })),
    tools: state.tools.map((tool) => ({ ...tool })),
  };
}

function upsertTool(
  state: RunLiveSnapshotState,
  toolCallId: string,
  name: string,
): LiveTool {
  const existing = state.tools.find((item) => item.toolCallId === toolCallId);
  if (existing) {
    if (name) existing.name = name;
    return existing;
  }
  const tool: LiveTool = {
    toolCallId,
    name,
    status: "running",
    safeSummary: null,
  };
  pushCapped(state.tools, tool);
  return tool;
}

function pushCapped<T>(list: T[], value: T): void {
  list.push(value);
  if (list.length > MAX_SNAPSHOT_ITEMS) list.shift();
}
