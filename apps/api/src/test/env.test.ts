import { describe, expect, it } from "vitest";
import { parseEnv } from "@api/shared/env.js";

/** 最小合法 env：BETTER_AUTH_SECRET 必填，其余字段走默认值。 */
const baseEnv = {
  BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
};

describe("parseEnv AI 超时配置", () => {
  it("不传 AI_RUN_MAX_MS 时默认 120000", () => {
    const env = parseEnv({ ...baseEnv });
    expect(env.AI_RUN_MAX_MS).toBe(120_000);
  });

  it("传入 AI_RUN_MAX_MS 合法值时正确解析", () => {
    const env = parseEnv({ ...baseEnv, AI_RUN_MAX_MS: "600000" });
    expect(env.AI_RUN_MAX_MS).toBe(600_000);
  });

  it("传入 AI_RUN_MAX_MS 超过上限 3600000 时报错", () => {
    expect(() => parseEnv({ ...baseEnv, AI_RUN_MAX_MS: "3600001" })).toThrow();
  });

  it("传入 AI_RUN_MAX_MS 低于下限 1000 时报错", () => {
    expect(() => parseEnv({ ...baseEnv, AI_RUN_MAX_MS: "999" })).toThrow();
  });

  it("放宽后 AI_REQUEST_TIMEOUT_MS 3600000 能通过", () => {
    const env = parseEnv({ ...baseEnv, AI_REQUEST_TIMEOUT_MS: "3600000" });
    expect(env.AI_REQUEST_TIMEOUT_MS).toBe(3_600_000);
  });

  it("传入 AI_REQUEST_TIMEOUT_MS 超过上限 3600000 时报错", () => {
    expect(() =>
      parseEnv({ ...baseEnv, AI_REQUEST_TIMEOUT_MS: "3600001" }),
    ).toThrow();
  });
});
