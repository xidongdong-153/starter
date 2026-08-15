import { describe, expect, it, vi } from "vitest";

import { runAiAuth } from "@api/scripts/ai-auth.js";

describe("ai:auth command", () => {
  it("拒绝命令行 secret 和未知参数", async () => {
    const output = { log: vi.fn(), error: vi.fn() };
    const interaction = { prompt: vi.fn(), notify: vi.fn() };

    await expect(
      runAiAuth(["openai-codex", "--api-key=secret"], interaction, {}, output),
    ).resolves.toBe(1);
    expect(interaction.prompt).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining("用法"));
    expect(JSON.stringify(output.error.mock.calls)).not.toContain("secret");
  });

  it("缺少加密主密钥时不会启动 OAuth 流程", async () => {
    const output = { log: vi.fn(), error: vi.fn() };
    const interaction = { prompt: vi.fn(), notify: vi.fn() };

    await expect(
      runAiAuth(
        ["openai-codex"],
        interaction,
        { BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters" },
        output,
      ),
    ).resolves.toBe(1);
    expect(interaction.prompt).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(
      expect.stringContaining("AI_CREDENTIAL_ENCRYPTION_KEY"),
    );
  });
});
