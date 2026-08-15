import type { AiAuthInteraction, AiAuthPrompt } from "@api/infra/ai/index.js";
import { createAiCrypto, createAiRuntime } from "@api/infra/ai/index.js";
import { createDatabase } from "@api/infra/db/client.js";
import { createAiRepository } from "@api/modules/ai/ai.repository.js";
import { parseEnv } from "@api/shared/env.js";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Writable } from "node:stream";

interface AiAuthOutput {
  error: (message: string) => void;
  log: (message: string) => void;
}

export async function runAiAuth(
  args: readonly string[],
  interaction: AiAuthInteraction,
  input: NodeJS.ProcessEnv = process.env,
  output: AiAuthOutput = console,
): Promise<0 | 1> {
  let database: ReturnType<typeof createDatabase> | undefined;

  try {
    const command = parseCommand(args);
    const env = parseEnv(input);
    const crypto = createAiCrypto(env.AI_CREDENTIAL_ENCRYPTION_KEY);
    if (!command.logout && !crypto.available) {
      throw new Error(
        "未配置 AI_CREDENTIAL_ENCRYPTION_KEY，不能保存 OAuth 凭据",
      );
    }

    database = createDatabase(env.DATABASE_PATH);
    const runtime = createAiRuntime(database.db, crypto);
    await runtime.ensureReady();
    const provider = runtime.providers.find(
      (item) => item.id === command.providerId,
    );
    if (!provider) throw new Error("Provider 不存在");
    if (!provider.supportedAuthModes.includes("oauth"))
      throw new Error("这个 Provider 不支持 OAuth");

    const repository = createAiRepository(database.db);
    if (
      command.logout &&
      repository.findProviderConfig(command.providerId)?.credentialType !==
        "oauth"
    ) {
      throw new Error("这个 Provider 没有已保存的 OAuth 凭据");
    }

    if (command.logout) {
      await runtime.logout(command.providerId, interaction.signal);
    } else {
      await runtime.login(command.providerId, "oauth", interaction);
    }

    repository.markCredentialChanged(command.providerId);
    output.log(
      command.logout
        ? "已清除 OAuth 凭据，Provider 已停用，请重新检查认证"
        : "OAuth 凭据已加密保存，Provider 已停用，请重新检查认证",
    );
    return 0;
  } catch (error) {
    if (error instanceof Error && /no such table:/iu.test(error.message)) {
      output.error(
        "AI 配置表不存在，请先运行 pnpm --filter @starter/api db:migrate",
      );
    } else {
      output.error(
        error instanceof Error ? error.message : "AI 认证命令执行失败",
      );
    }
    return 1;
  } finally {
    database?.sqlite.close();
  }
}

function parseCommand(args: readonly string[]) {
  const logout = args.includes("--logout");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const unknownOptions = args.filter(
    (arg) => arg.startsWith("--") && arg !== "--logout",
  );
  if (unknownOptions.length > 0 || positional.length !== 1) {
    throw new Error(
      "用法：pnpm --filter @starter/api ai:auth -- <providerId> [--logout]",
    );
  }
  return { providerId: positional[0]!, logout };
}

function createTerminalInteraction(): AiAuthInteraction {
  return {
    async prompt(prompt) {
      if (prompt.type === "select") {
        for (const option of prompt.options) {
          process.stdout.write(
            `${option.id}: ${option.label}${option.description ? ` - ${option.description}` : ""}\n`,
          );
        }
      }
      const answer = await askTerminal(prompt);
      if (
        prompt.type === "select" &&
        !prompt.options.some((option) => option.id === answer)
      ) {
        throw new Error("输入的选项不存在");
      }
      return answer;
    },
    notify(event) {
      if (event.type === "auth_url") {
        process.stdout.write(
          `${event.instructions ?? "打开以下地址完成认证"}\n${event.url}\n`,
        );
      } else if (event.type === "device_code") {
        process.stdout.write(
          `打开 ${event.verificationUri}，输入设备码 ${event.userCode}\n`,
        );
      } else if (event.type === "info") {
        process.stdout.write(`${event.message}\n`);
        for (const link of event.links ?? [])
          process.stdout.write(`${link.label ?? "参考"}: ${link.url}\n`);
      } else {
        process.stdout.write(`${event.message}\n`);
      }
    },
  };
}

async function askTerminal(prompt: AiAuthPrompt): Promise<string> {
  if (prompt.type !== "secret") {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return await readline.question(`${prompt.message}: `, {
        signal: prompt.signal,
      });
    } finally {
      readline.close();
    }
  }

  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const readline = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  try {
    process.stdout.write(`${prompt.message}: `);
    muted = true;
    const value = await readline.question("", { signal: prompt.signal });
    process.stdout.write("\n");
    return value;
  } finally {
    muted = false;
    readline.close();
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  process.exitCode = await runAiAuth(
    process.argv.slice(2),
    createTerminalInteraction(),
  );
}
