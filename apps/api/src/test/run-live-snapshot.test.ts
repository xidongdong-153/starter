import {
  agentRunLiveSnapshotSchema,
  harnessEventSchema,
} from "@starter/contracts";
import type { HarnessEvent } from "@starter/contracts";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { generateId } from "@api/shared/id.js";
import {
  applyRunEvent,
  createRunLiveSnapshot,
  toAgentRunLiveSnapshot,
} from "@api/modules/ai/run/run.live-snapshot.js";

const sessionId = generateId();
const runId = generateId();

let sequence = 0;

function event<T extends HarnessEvent["type"]>(
  type: T,
  data: Extract<HarnessEvent, { type: T }>["data"],
): HarnessEvent {
  sequence += 1;
  return {
    version: 1,
    eventId: generateId(),
    sequence,
    sessionId,
    runId,
    lane: "main",
    createdAt: new Date().toISOString(),
    type,
    data,
  } as HarnessEvent;
}

it("live 快照按事件顺序折叠成一条 timeline", () => {
  sequence = 0;
  const state = createRunLiveSnapshot(4);
  const firstMessage = generateId();
  const secondMessage = generateId();
  const compactionEntry = generateId();

  const events = [
    event("turn.started", { turn: 1, maxTurns: 4 }),
    event("message.started", { messageId: firstMessage, role: "assistant" }),
    event("thinking.started", { messageId: firstMessage, blockIndex: 0 }),
    event("thinking.delta", {
      messageId: firstMessage,
      blockIndex: 0,
      delta: "先想",
    }),
    event("thinking.delta", {
      messageId: firstMessage,
      blockIndex: 0,
      delta: "一下",
    }),
    event("message.delta", { messageId: firstMessage, delta: "查一下" }),
    event("message.completed", {
      messageId: firstMessage,
      role: "assistant",
      content: "查一下",
      stopReason: "tool_use",
      errorCode: null,
      usage: {
        inputTokens: 3,
        outputTokens: 4,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cacheWrite1hTokens: null,
        reasoningTokens: null,
        totalTokens: 7,
      },
    }),
    event("tool.started", { toolCallId: "tool-1", name: "lookup" }),
    event("tool.completed", {
      toolCallId: "tool-1",
      name: "lookup",
      status: "succeeded",
      errorCode: null,
      safeSummary: "查到了",
      entryId: generateId(),
    }),
    event("context.compacted", {
      entryId: compactionEntry,
      tokensBefore: 12_000,
      summary: "压缩摘要",
    }),
    event("turn.started", { turn: 2, maxTurns: 4 }),
    event("message.started", { messageId: secondMessage, role: "assistant" }),
    event("message.delta", { messageId: secondMessage, delta: "答案" }),
  ];
  for (const item of events) applyRunEvent(state, item);

  const snapshot = toAgentRunLiveSnapshot(state);
  expect(agentRunLiveSnapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(snapshot.turn).toBe(2);
  expect(snapshot.maxTurns).toBe(4);
  expect(snapshot.lastSequence).toBe(events.length);
  // 元素顺序与事件顺序一致：消息、工具、压缩、消息
  expect(snapshot.timeline.map((item) => item.kind)).toEqual([
    "message",
    "tool",
    "compaction",
    "message",
  ]);
  expect(snapshot.timeline[0]).toMatchObject({
    kind: "message",
    messageId: firstMessage,
    completed: true,
    // message.completed 用事件 content 覆盖 text 块，thinking 块保留
    blocks: [
      { type: "thinking", text: "先想一下" },
      { type: "text", text: "查一下" },
    ],
    usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
  });
  expect(snapshot.timeline[1]).toMatchObject({
    kind: "tool",
    toolCallId: "tool-1",
    status: "succeeded",
    safeSummary: "查到了",
  });
  expect(snapshot.timeline[2]).toMatchObject({
    kind: "compaction",
    entryId: compactionEntry,
    summary: "压缩摘要",
  });
  // 未完成的消息保持流式状态
  expect(snapshot.timeline[3]).toMatchObject({
    kind: "message",
    messageId: secondMessage,
    completed: false,
    blocks: [{ type: "text", text: "答案" }],
  });
});

it("interleaved thinking 的块顺序在 message.completed 后不变", () => {
  sequence = 0;
  const state = createRunLiveSnapshot(4);
  const messageId = generateId();

  const events = [
    event("message.started", { messageId, role: "assistant" }),
    event("message.delta", { messageId, delta: "先给结论。" }),
    event("thinking.started", { messageId, blockIndex: 1 }),
    event("thinking.delta", { messageId, blockIndex: 1, delta: "再想一步" }),
    event("message.delta", { messageId, delta: "补充一句。" }),
    event("message.completed", {
      messageId,
      role: "assistant",
      content: "先给结论。补充一句。",
      stopReason: "stop",
      errorCode: null,
    }),
  ];
  for (const item of events) applyRunEvent(state, item);

  const snapshot = toAgentRunLiveSnapshot(state);
  expect(agentRunLiveSnapshotSchema.safeParse(snapshot).success).toBe(true);
  // 多个 text 块时保留 delta 累积出来的原顺序，不把 thinking 提到前面、也不折叠 text
  expect(snapshot.timeline[0]).toMatchObject({
    kind: "message",
    completed: true,
    blocks: [
      { type: "text", text: "先给结论。" },
      { type: "thinking", text: "再想一步" },
      { type: "text", text: "补充一句。" },
    ],
  });
});

it("sequence 不递增的事件被忽略，timeline 超过上限丢最旧的", () => {
  sequence = 0;
  const state = createRunLiveSnapshot(8);
  const messageId = generateId();
  applyRunEvent(
    state,
    event("message.started", { messageId, role: "assistant" }),
  );
  const delta = event("message.delta", { messageId, delta: "a" });
  applyRunEvent(state, delta);
  // 重放同一条事件不重复累加
  applyRunEvent(state, delta);
  expect(toAgentRunLiveSnapshot(state).timeline[0]).toMatchObject({
    blocks: [{ type: "text", text: "a" }],
  });

  for (let index = 0; index < 200; index += 1) {
    applyRunEvent(
      state,
      event("tool.started", { toolCallId: `tool-${index}`, name: "lookup" }),
    );
  }
  const snapshot = toAgentRunLiveSnapshot(state);
  expect(snapshot.timeline).toHaveLength(128);
  expect(snapshot.timeline.every((item) => item.kind === "tool")).toBe(true);
  expect(snapshot.timeline[0]).toMatchObject({ toolCallId: "tool-72" });
  expect(agentRunLiveSnapshotSchema.safeParse(snapshot).success).toBe(true);
});

// 同构回归用例的事件与期望快照放在仓库根的 test-fixtures/：admin 不能 import api 源码、
// api 也不能把文件放到 rootDir 之外，两侧只能按路径读同一份 JSON。
// 对应的前端断言在 apps/admin/src/test/harness-timeline.test.ts。
const fixturePath = new URL(
  "../../../../test-fixtures/harness-timeline-isomorphism.json",
  import.meta.url,
);

it("共享事件 fixture 折叠出的 live 快照与前端期望一致", () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    events: unknown[];
    liveSnapshot: unknown;
  };
  const events = fixture.events.map((item): HarnessEvent =>
    harnessEventSchema.parse(item),
  );
  const expected = agentRunLiveSnapshotSchema.parse(fixture.liveSnapshot);

  const state = createRunLiveSnapshot(expected.maxTurns);
  for (const item of events) applyRunEvent(state, item);

  // fixture 里的 liveSnapshot 就是前端 timeline 测试读的那一份，两边不许各自漂移
  expect(toAgentRunLiveSnapshot(state)).toEqual(expected);
});
