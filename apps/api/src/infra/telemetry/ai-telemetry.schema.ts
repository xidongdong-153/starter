import { defineTelemetrySchema } from "@earendil-works/pi-telemetry";
import type {
  TelemetrySchemaSpanEndAttributes,
  TelemetrySchemaSpanName,
  TelemetrySchemaSpanStartAttributes,
} from "@earendil-works/pi-telemetry";

/**
 * Starter AI Runtime 的 span 词表。
 *
 * span 树固定为 `starter.ai.run -> starter.ai.turn -> starter.ai.step ->
 * starter.ai.model_call / starter.ai.tool_execution`，属性只放非敏感 ID、
 * 枚举、计数、耗时和用量。prompt、message 正文、reasoning 正文、Tool 参数、
 * Tool 原始结果、Provider 原始错误和 secret 一律不写入。
 */
export const STARTER_AI_TELEMETRY_SCHEMA = defineTelemetrySchema({
  version: 1,
  spans: {
    "starter.ai.run": {
      description: "一次 Agent Run 的完整异步执行",
      parents: { kind: "root_or_external" },
      startAttributes: {
        "starter.ai.run.id": {
          type: "string",
          required: true,
          cardinality: "high",
          description: "Run ID",
        },
        "starter.ai.session.id": {
          type: "string",
          required: true,
          cardinality: "high",
          description: "Agent Session ID",
        },
        "starter.ai.lane": {
          type: "string",
          required: true,
          cardinality: "high",
          description: "Session lane 名称",
        },
        "starter.ai.request.id": {
          type: "string",
          required: true,
          cardinality: "high",
          description: "触发 Run 的请求 ID",
        },
        "starter.ai.principal.kind": {
          type: "string",
          required: true,
          values: ["starter_user", "product_app"],
          description: "运行面主体类型",
        },
        "starter.ai.tenant.id": {
          type: "string",
          required: true,
          description: "Scope tenant ID",
        },
        "starter.ai.project.id": {
          type: "string",
          required: true,
          description: "Scope project ID",
        },
        "starter.ai.application.id": {
          type: "string",
          required: false,
          cardinality: "high",
          description: "应用凭据 ID，Starter 用户为空",
        },
        "starter.ai.external_user.id": {
          type: "string",
          required: false,
          cardinality: "high",
          description: "调用方的外部用户 ID",
        },
        "starter.ai.subject.type": {
          type: "string",
          required: false,
          description: "Scope subject 类型",
        },
        "starter.ai.subject.id": {
          type: "string",
          required: false,
          cardinality: "high",
          description: "Scope subject ID",
        },
        "starter.ai.agent.id": {
          type: "string",
          required: true,
          description: "AgentDefinition ID",
        },
        "starter.ai.agent.revision": {
          type: "number",
          required: true,
          description: "Run 启动时固定的 Agent revision",
        },
        "starter.ai.provider": {
          type: "string",
          required: true,
          description: "Provider ID",
        },
        "starter.ai.model": {
          type: "string",
          required: true,
          description: "请求的模型 ID",
        },
        "starter.ai.output.mode": {
          type: "string",
          required: true,
          values: ["optional", "required"],
          description: "结构化输出模式",
        },
        "starter.ai.output.contract.name": {
          type: "string",
          required: false,
          description: "已解析的 Output Contract 名称",
        },
        "starter.ai.output.contract.version": {
          type: "string",
          required: false,
          description: "已解析的 Output Contract semver",
        },
      },
      endAttributes: {
        "starter.ai.run.outcome": {
          type: "string",
          values: ["completed", "failed", "aborted", "interrupted"],
          description: "Run 终态",
        },
        "starter.ai.run.completion_reason": {
          type: "string",
          values: ["model_finished", "max_turns", "structured_output"],
          description: "completed 终态的完成原因",
        },
        "starter.ai.error.code": {
          type: "string",
          cardinality: "low",
          description: "稳定错误码",
        },
        "starter.ai.error.category": {
          type: "string",
          values: [
            "auth",
            "upstream",
            "timeout",
            "cancelled",
            "storage",
            "tool",
            "validation",
            "unknown",
          ],
          description: "错误分类",
        },
      },
      status: { default: "ok", errorWhen: "Run 终态不是 completed" },
    },
    "starter.ai.turn": {
      description: "Agent loop 的一个轮次",
      parents: { kind: "spans", spans: ["starter.ai.run"] },
      startAttributes: {
        "starter.ai.run.id": {
          type: "string",
          required: true,
          cardinality: "high",
          description: "Run ID",
        },
        "starter.ai.turn.id": {
          type: "string",
          required: true,
          cardinality: "high",
          description: "Turn ID，与 ai_run_turns.id 一致",
        },
        "starter.ai.turn.index": {
          type: "number",
          required: true,
          description: "Run 内 1-based 轮次序号",
        },
      },
      endAttributes: {
        "starter.ai.turn.outcome": {
          type: "string",
          values: ["succeeded", "failed", "aborted"],
          description: "Turn 终态",
        },
      },
      status: { default: "ok", errorWhen: "Turn 终态不是 succeeded" },
    },
    "starter.ai.step": {
      description: "一次模型执行尝试或上下文压缩",
      parents: { kind: "spans", spans: ["starter.ai.turn", "starter.ai.run"] },
      startAttributes: {
        "starter.ai.run.id": {
          type: "string",
          required: true,
          cardinality: "high",
          description: "Run ID",
        },
        "starter.ai.turn.id": {
          type: "string",
          required: false,
          cardinality: "high",
          description: "所属 Turn ID",
        },
        "starter.ai.step.id": {
          type: "string",
          required: true,
          cardinality: "high",
          description: "Step ID；assistant step 与 ai_run_steps.id 一致",
        },
        "starter.ai.step.kind": {
          type: "string",
          required: true,
          values: ["assistant", "compaction", "branch_summary"],
          description: "Step 类型",
        },
        "starter.ai.step.attempt": {
          type: "number",
          required: true,
          description: "1-based attempt",
        },
      },
      endAttributes: {
        "starter.ai.step.outcome": {
          type: "string",
          values: [
            "succeeded",
            "retry",
            "failed",
            "aborted",
            "deferred",
            "overflow",
          ],
          description: "Step 终态",
        },
        "starter.ai.error.code": {
          type: "string",
          cardinality: "low",
          description: "稳定错误码",
        },
      },
      status: { default: "ok", errorWhen: "Step 终态不是 succeeded" },
    },
    "starter.ai.model_call": {
      description: "一次 Provider 模型请求",
      parents: { kind: "spans", spans: ["starter.ai.step", "starter.ai.run"] },
      startAttributes: {
        "starter.ai.run.id": {
          type: "string",
          required: true,
          cardinality: "high",
          description: "Run ID",
        },
        "starter.ai.turn.id": {
          type: "string",
          required: false,
          cardinality: "high",
          description: "所属 Turn ID",
        },
        "starter.ai.step.id": {
          type: "string",
          required: false,
          cardinality: "high",
          description: "所属 Step ID",
        },
        "starter.ai.provider": {
          type: "string",
          required: true,
          description: "Provider ID",
        },
        "starter.ai.model": {
          type: "string",
          required: true,
          description: "请求的模型 ID",
        },
        "starter.ai.api": {
          type: "string",
          required: true,
          description: "Provider API ID",
        },
        "starter.ai.streaming": {
          type: "boolean",
          required: true,
          description: "是否是流式请求",
        },
      },
      endAttributes: {
        "starter.ai.model_call.id": {
          type: "string",
          cardinality: "high",
          description: "Model Call ID，与 ai_model_calls.id 一致",
        },
        "starter.ai.model_call.result": {
          type: "string",
          values: [
            "succeeded",
            "upstream_failed",
            "auth_failed",
            "timed_out",
            "cancelled",
            "interrupted",
          ],
          description: "模型调用结果",
        },
        "starter.ai.response.model": {
          type: "string",
          description: "Provider 返回的实际模型",
        },
        "starter.ai.response.id": {
          type: "string",
          cardinality: "high",
          description: "Provider 响应 ID",
        },
        "starter.ai.response.stop_reason": {
          type: "string",
          values: [
            "stop",
            "length",
            "tool_use",
            "error",
            "aborted",
            "deferred",
          ],
          description: "归一化后的停止原因",
        },
        "starter.ai.http.status_code": {
          type: "number",
          description: "Provider HTTP 状态码",
        },
        "starter.ai.usage.input_tokens": {
          type: "number",
          description: "输入 token",
        },
        "starter.ai.usage.output_tokens": {
          type: "number",
          description: "输出 token",
        },
        "starter.ai.usage.cache_read_tokens": {
          type: "number",
          description: "缓存读取 token",
        },
        "starter.ai.usage.cache_write_tokens": {
          type: "number",
          description: "缓存写入 token",
        },
        "starter.ai.usage.reasoning_tokens": {
          type: "number",
          description: "reasoning token",
        },
        "starter.ai.usage.total_tokens": {
          type: "number",
          description: "总 token",
        },
        "starter.ai.usage.cost": {
          type: "number",
          description: "总成本，单位 USD",
        },
        "starter.ai.stream.chunk_count": {
          type: "number",
          description: "转发的 Provider stream update 数量，含 start 事件",
        },
        "starter.ai.stream.time_to_first_output_ms": {
          type: "number",
          description: "到首个内容 update 的毫秒数，不含 start 协议事件",
        },
        "starter.ai.duration_ms": {
          type: "number",
          description: "模型请求总耗时毫秒",
        },
        "starter.ai.error.code": {
          type: "string",
          cardinality: "low",
          description: "稳定错误码",
        },
        "starter.ai.error.type": {
          type: "string",
          values: ["auth", "timeout", "aborted", "upstream", "model_not_found"],
          cardinality: "low",
          description: "失败首因分类",
        },
      },
      status: { default: "ok", errorWhen: "模型调用结果不是 succeeded" },
    },
    "starter.ai.tool_execution": {
      description: "一次 Tool 执行",
      parents: {
        kind: "spans",
        spans: ["starter.ai.step", "starter.ai.turn", "starter.ai.run"],
      },
      startAttributes: {
        "starter.ai.run.id": {
          type: "string",
          required: false,
          cardinality: "high",
          description: "Run ID",
        },
        "starter.ai.turn.id": {
          type: "string",
          required: false,
          cardinality: "high",
          description: "所属 Turn ID",
        },
        "starter.ai.step.id": {
          type: "string",
          required: false,
          cardinality: "high",
          description: "所属 Step ID",
        },
        "starter.ai.model_call.id": {
          type: "string",
          required: false,
          cardinality: "high",
          description: "触发 Tool 的 Model Call ID",
        },
        "starter.ai.tool.name": {
          type: "string",
          required: true,
          description: "Tool 名称",
        },
        "starter.ai.tool.version": {
          type: "string",
          required: false,
          description: "Tool 精确版本",
        },
        "starter.ai.tool.call_id": {
          type: "string",
          required: true,
          cardinality: "high",
          description: "Pi 生成的 toolCallId",
        },
        "starter.ai.tool.attempt": {
          type: "number",
          required: true,
          description: "同一 toolCallId 的 1-based 执行次数",
        },
        "starter.ai.tool.recovery": {
          type: "boolean",
          required: true,
          description: "是否是同一 toolCallId 的重试或恢复执行",
        },
      },
      endAttributes: {
        "starter.ai.tool.execution_id": {
          type: "string",
          cardinality: "high",
          description: "Tool Execution ID，与 ai_tool_executions.id 一致",
        },
        "starter.ai.tool.status": {
          type: "string",
          values: [
            "succeeded",
            "not_found",
            "invalid_arguments",
            "forbidden",
            "failed",
            "timed_out",
            "cancelled",
            "interrupted",
          ],
          description: "Tool 结果状态",
        },
        "starter.ai.tool.timeout_ms": {
          type: "number",
          description: "实际生效的 timeout 毫秒",
        },
        "starter.ai.duration_ms": {
          type: "number",
          description: "Tool 执行耗时毫秒",
        },
        "starter.ai.error.code": {
          type: "string",
          cardinality: "low",
          description: "稳定错误码",
        },
      },
      status: { default: "ok", errorWhen: "Tool 结果状态不是 succeeded" },
    },
  },
} as const);

export type StarterAiTelemetrySchema = typeof STARTER_AI_TELEMETRY_SCHEMA;

/** Starter AI span 名称。 */
export type AiSpanName = TelemetrySchemaSpanName<StarterAiTelemetrySchema>;

/** 某个 span 创建时必须提供的属性。 */
export type AiSpanStartAttributes<Name extends AiSpanName> =
  TelemetrySchemaSpanStartAttributes<StarterAiTelemetrySchema, Name>;

/** 某个 span 完成时可补充的属性。 */
export type AiSpanEndAttributes<Name extends AiSpanName> =
  TelemetrySchemaSpanEndAttributes<StarterAiTelemetrySchema, Name>;
