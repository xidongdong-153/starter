import type { AiOutputContractRef } from "@starter/contracts";
import { defineAiTool, type RegisteredAiTool } from "../tool/tool-registry.js";
import type { ResolvedAiOutputContract } from "./output-contract-registry.js";

export interface StructuredOutputRuntime {
  persist: (input: {
    runId: string;
    stepId: string;
    contract: ResolvedAiOutputContract;
    value: Record<string, unknown>;
  }) => { id: string };
  publish: (input: {
    contract: AiOutputContractRef;
    value: Record<string, unknown> | null;
    referenceId: string;
    /** 事件 envelope 的其余关联字段由 Run Service 从执行上下文填。 */
    toolCallId: string;
  }) => void;
}

export class StructuredOutputStorageError extends Error {
  constructor() {
    super("Structured Output persistence failed");
    this.name = "StructuredOutputStorageError";
  }
}

export function createStructuredOutputTool(
  contract: ResolvedAiOutputContract,
  runtime: StructuredOutputRuntime,
): RegisteredAiTool {
  return defineAiTool({
    name: "emit_structured_output",
    version: "1.0.0",
    description: `Emit a validated ${contract.name} result.`,
    inputSchema: contract.schema,
    timeoutMs: 5_000,
    scope: "platform",
    requiredPermission: null,
    internal: true,
    execute: async (context, input) => {
      const parsed = contract.schema.safeParse(input);
      if (!parsed.success) {
        return {
          modelText:
            "The structured output is invalid. Correct the fields and try again.",
          safeSummary: "Structured output validation failed",
        };
      }
      const runId = context.runId;
      const stepId = context.stepId;
      if (!runId || !stepId) {
        throw new Error("Structured Output requires run and step context");
      }
      let record: { id: string };
      try {
        record = runtime.persist({
          runId,
          stepId,
          contract,
          value: parsed.data,
        });
        runtime.publish({
          contract: contract.ref,
          value: contract.visibility === "product" ? parsed.data : null,
          referenceId: record.id,
          toolCallId: context.toolCallId ?? "",
        });
      } catch {
        throw new StructuredOutputStorageError();
      }
      return {
        modelText: "Structured output accepted.",
        safeSummary: "Structured output available",
        terminate: true,
        structuredOutputId: record.id,
      };
    },
  });
}
