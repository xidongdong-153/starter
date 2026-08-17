import { z } from "zod";

import { defineAiTool, type RegisteredAiTool } from "../tool/tool-registry.js";
import type { AiSkillRepository } from "./skill.repository.js";

/**
 * read_skill 基础工具：模型按需加载启用中技能的完整内容。
 *
 * 与测试工具不同，read_skill 始终注册（不依赖 AI_TEST_TOOLS_ENABLED），
 * 通过闭包注入 skills repository；无技能或未启用时抛错走 failed 状态。
 */
export function createReadSkillTool(
  repository: AiSkillRepository,
): RegisteredAiTool {
  return defineAiTool({
    name: "read_skill",
    description:
      "读取技能的完整内容。可用的技能列表（名称与描述）在系统提示词的 <available_skills> 中，输入技能 name 返回该技能的完整内容。",
    inputSchema: z.object({
      name: z.string().trim().min(1).max(64),
    }),
    timeoutMs: 5000,
    requiredPermission: null,
    async execute(_context, input) {
      const skill = repository.findEnabledSkillByName(input.name);
      if (!skill) {
        throw new Error(`技能不存在或未启用: ${input.name}`);
      }
      return {
        modelText: skill.content,
        safeSummary: `已加载技能 ${skill.name}`,
      };
    },
  });
}

/**
 * 把启用中的技能描述列表拼装成 XML 块，追加到 system prompt 之后。
 * 无技能时返回原 system prompt（undefined 保持 undefined）。
 */
export function appendSkillDescriptions(
  systemPrompt: string | undefined,
  skills: readonly { name: string; description: string }[],
): string | undefined {
  if (skills.length === 0) return systemPrompt;
  const lines = [
    "<available_skills>",
    ...skills.map(
      (skill) =>
        `  <skill>\n    <name>${escapeXml(skill.name)}</name>\n    <description>${escapeXml(skill.description)}</description>\n  </skill>`,
    ),
    "</available_skills>",
  ];
  const block = lines.join("\n");
  return systemPrompt ? `${systemPrompt}\n\n${block}` : block;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
