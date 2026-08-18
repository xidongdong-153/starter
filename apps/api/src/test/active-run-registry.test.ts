import { describe, expect, it, vi } from "vitest";

import {
  ActiveRunRegistryError,
  createActiveRunRegistry,
} from "@api/infra/agent/active-run-registry.js";

describe("activeRunRegistry", () => {
  it("按 session + lane 原子 reserve，并拒绝第二个 lease", () => {
    const registry = createActiveRunRegistry();
    const first = registry.reserve({ sessionId: "session-1", lane: "main" });

    expect(() => registry.reserve("session-1", "main")).toThrowError(
      new ActiveRunRegistryError("busy"),
    );
    expect(registry.getBySessionLane("session-1", "main")).toBeUndefined();

    registry.release(first);
    expect(registry.reserve("session-1", "main")).toBeDefined();
  });

  it("attach 前不暴露 handle，attach 后同时按 runId 和 lane 查询", () => {
    const registry = createActiveRunRegistry();
    const lease = registry.reserve("session-1", "review");
    let attached = false;
    const controls = {
      attach: vi.fn(() => {
        attached = true;
      }),
      isAttached: () => attached,
      abort: vi.fn(),
      steer: vi.fn(),
      followUp: vi.fn(),
    };

    expect(registry.get("run-1")).toBeUndefined();
    const handle = registry.attach(lease, "run-1", controls);

    expect(controls.attach).toHaveBeenCalledOnce();
    expect(registry.get("run-1")).toBe(handle);
    expect(registry.getBySessionLane("session-1", "review")).toBe(handle);
    expect(handle.controls).toBe(controls);
  });

  it("把 abort、steer、follow-up 转发给 Pi controls，并幂等清理两个索引", () => {
    const registry = createActiveRunRegistry();
    const lease = registry.reserve("session-1", "main");
    const controls = {
      attach: vi.fn(),
      isAttached: () => true,
      abort: vi.fn(),
      steer: vi.fn(),
      followUp: vi.fn(),
    };
    registry.attach(lease, "run-1", controls);

    registry.abort("run-1");
    registry.steer("run-1", "change direction");
    registry.followUp("run-1", "summarize");

    expect(controls.abort).toHaveBeenCalledOnce();
    expect(controls.steer).toHaveBeenCalledWith("change direction");
    expect(controls.followUp).toHaveBeenCalledWith("summarize");

    registry.release("run-1");
    registry.release("run-1");
    expect(registry.get("run-1")).toBeUndefined();
    expect(registry.getBySessionLane("session-1", "main")).toBeUndefined();
    expect(() => registry.abort("run-1")).toThrowError(
      new ActiveRunRegistryError("not_active"),
    );
  });

  it("拒绝不属于 registry 的 lease", () => {
    const first = createActiveRunRegistry();
    const second = createActiveRunRegistry();
    const lease = first.reserve("session-1", "main");
    const controls = {
      attach: vi.fn(),
      isAttached: () => true,
      abort: vi.fn(),
      steer: vi.fn(),
      followUp: vi.fn(),
    };

    expect(() => second.attach(lease, "run-1", controls)).toThrowError(
      new ActiveRunRegistryError("invalid_lease"),
    );
  });
});
