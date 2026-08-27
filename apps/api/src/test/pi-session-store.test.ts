import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createPiSessionStore } from "@api/infra/agent/pi-session-store.js";
import { expect, it } from "vitest";

const message: AgentMessage = {
  role: "user",
  content: "hello",
  timestamp: Date.now(),
};

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "starter-pi-session-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  return {
    directory,
    store,
    databasePath: join(directory, "agent-sessions.db"),
  };
}

it("创建、打开、追加并重放 Session transcript", async () => {
  const fixture = await createFixture();
  try {
    const created = await fixture.store.createSession({ id: "session-1" });
    const appended = await created.appendMessage("main", message);

    expect(appended.type).toBe("message");
    expect(
      await fixture.store.readTranscript({
        sessionId: "session-1",
        lane: "main",
      }),
    ).toMatchObject([{ id: appended.id, type: "message" }]);

    const opened = await fixture.store.openSession("session-1");
    expect(opened.metadata.id).toBe("session-1");
    expect(await opened.readTranscript()).toHaveLength(1);
  } finally {
    await fixture.store.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

it("隔离 lane，并保留 starter.run 的原始 data", async () => {
  const fixture = await createFixture();
  try {
    const session = await fixture.store.createSession({ id: "session-1" });
    await session.appendMessage("main", message);
    await session.createLane("review");
    await session.appendMessage("review", {
      ...message,
      content: "review",
    });

    const terminal = await session.appendRunTerminalEntry("review", {
      schemaVersion: 1,
      runId: "run-1",
      malformed: { preserved: true },
    });
    expect(terminal.data).toEqual({
      schemaVersion: 1,
      runId: "run-1",
      malformed: { preserved: true },
    });
    const duplicate = await session.appendRunTerminalEntry("review", {
      schemaVersion: "invalid",
      runId: "run-1",
    });
    expect(
      await session.findRunTerminalEntries({ lane: "review", runId: "run-1" }),
    ).toEqual([terminal, duplicate]);
    expect(
      await session.findRunTerminalEntries({
        lane: "review",
        runId: "missing",
      }),
    ).toEqual([]);
    expect(
      await fixture.store.readTranscript({
        sessionId: "session-1",
        lane: "main",
      }),
    ).toHaveLength(1);
    expect(
      await fixture.store.readTranscript({
        sessionId: "session-1",
        lane: "review",
      }),
    ).toHaveLength(3);
  } finally {
    await fixture.store.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

it("newestFirst 从新到旧读取，cursor 取更早的 entry", async () => {
  const fixture = await createFixture();
  try {
    const session = await fixture.store.createSession({ id: "session-1" });
    for (let index = 1; index <= 4; index += 1) {
      await session.appendMessage("main", {
        ...message,
        content: `消息 ${index}`,
      });
    }

    const newest = await fixture.store.readTranscript({
      sessionId: "session-1",
      lane: "main",
      order: "newestFirst",
      limit: 2,
    });
    expect(newest.map((entry) => entry.seq)).toEqual([4, 3]);

    // newestFirst 下 cursor.afterSeq 的判据是 seq < afterSeq，即取更早的 entry
    const earlier = await fixture.store.readTranscript({
      sessionId: "session-1",
      lane: "main",
      order: "newestFirst",
      cursor: 3,
      limit: 2,
    });
    expect(earlier.map((entry) => entry.seq)).toEqual([2, 1]);

    // 默认仍然是 oldestFirst
    expect(
      (
        await fixture.store.readTranscript({
          sessionId: "session-1",
          lane: "main",
        })
      ).map((entry) => entry.seq),
    ).toEqual([1, 2, 3, 4]);
  } finally {
    await fixture.store.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

it("两个 Session DB 相互隔离，不向 app.db 写入 Pi 表", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-pi-isolation-"));
  const firstPath = join(directory, "first.db");
  const secondPath = join(directory, "second.db");
  const appPath = join(directory, "app.db");
  const first = createPiSessionStore({
    cwd: directory,
    databasePath: firstPath,
  });
  const second = createPiSessionStore({
    cwd: directory,
    databasePath: secondPath,
  });
  try {
    await first.createSession({ id: "same-id" });
    await first.appendRunTerminalEntry({
      sessionId: "same-id",
      lane: "main",
      data: { runId: "first-only" },
    });
    await second.createSession({ id: "same-id" });

    expect(
      await second.findRunTerminalEntries({
        sessionId: "same-id",
        runId: "first-only",
      }),
    ).toEqual([]);

    const appDb = new DatabaseSync(appPath);
    const tables = appDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'pi_%'",
      )
      .all() as { name: string }[];
    appDb.close();
    expect(tables).toEqual([]);
    expect((await stat(firstPath)).isFile()).toBe(true);
    expect((await stat(secondPath)).isFile()).toBe(true);
  } finally {
    await first.close();
    await second.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("删除 Session 后不可打开，close 可重复调用且临时目录可清理", async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.createSession({ id: "session-1" });
    await fixture.store.deleteSession("session-1");
    await expect(fixture.store.openSession("session-1")).rejects.toThrow(
      "Pi Session 不存在",
    );
  } finally {
    await fixture.store.close();
    await fixture.store.close();
    await rm(fixture.directory, { recursive: true, force: true });
    await expect(readFile(fixture.databasePath)).rejects.toThrow();
  }
});

it("支持调用方预置 message ID，并写入 Pi compaction entry", async () => {
  const fixture = await createFixture();
  try {
    const session = await fixture.store.createSession({ id: "session-1" });
    const messageEntry = await session.appendMessage(
      "main",
      message,
      "message-entry-1",
    );
    const compaction = await session.appendCompaction("main", {
      type: "compaction",
      id: "compaction-entry-1",
      summary: "summary",
      retainedTail: [message],
      tokensBefore: 10,
    });

    expect(messageEntry.id).toBe("message-entry-1");
    expect(compaction.id).toBe("compaction-entry-1");
    expect(await session.readTranscript()).toMatchObject([
      { type: "message", id: "message-entry-1" },
      { type: "compaction", id: "compaction-entry-1" },
    ]);
  } finally {
    await fixture.store.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
