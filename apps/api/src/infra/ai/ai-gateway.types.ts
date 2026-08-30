import type { AiCost, AiModelRef, AiUsage } from "@starter/contracts";
import type { ZodType } from "zod";

export interface AiModelContentMetadata {
  turnIndex: number;
  contentIndex: number;
  blockId: string;
}

export interface AiModelTextBlock extends AiModelContentMetadata {
  type: "text";
  text: string;
}

export interface AiModelToolCall extends AiModelContentMetadata {
  type: "tool_call";
  id: string;
  name: string;
  arguments: unknown;
}

export interface AiModelImageBlock extends AiModelContentMetadata {
  type: "image";
  /** base64 编码的图片字节；只在内存与模型请求中存在，不进 starter JSON 字段。 */
  data: string;
  mimeType: string;
}

export type AiModelContentBlock =
  AiModelTextBlock | AiModelToolCall | AiModelImageBlock;

export interface AiModelUserMessage {
  role: "user";
  content: (AiModelTextBlock | AiModelImageBlock)[];
  timestamp?: number;
}

export interface AiModelAssistantMessage {
  role: "assistant";
  blocks: (AiModelTextBlock | AiModelToolCall)[];
  timestamp?: number;
}

export interface AiModelToolResult {
  role: "tool_result";
  toolCallId: string;
  toolName: string;
  content: string;
  isError: boolean;
  timestamp?: number;
}

export type AiModelMessage =
  AiModelUserMessage | AiModelAssistantMessage | AiModelToolResult;

export interface AiModelToolDefinition {
  name: string;
  description: string;
  parameters: ZodType;
}

export interface AiGatewayInput {
  model: AiModelRef;
  systemPrompt?: string;
  messages: AiModelMessage[];
  tools?: AiModelToolDefinition[];
  sessionId?: string;
  turnIndex: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type AiGatewayStopReason =
  "stop" | "length" | "tool_use" | "aborted" | "error" | "deferred";

export type AiGatewayEvent =
  | ({ type: "text_delta" } & AiModelContentMetadata & { text: string })
  | ({ type: "tool_call_completed" } & Omit<AiModelToolCall, "type">)
  | {
      type: "completed";
      turnIndex: number;
      assistantMessage: AiModelAssistantMessage;
      stopReason: Extract<AiGatewayStopReason, "stop" | "length" | "tool_use">;
      usage: AiUsage;
      cost: AiCost | null;
    };

export type AiGatewayErrorKind =
  "aborted" | "auth" | "model_not_found" | "timeout" | "upstream";

export type AiGatewayErrorCode = AiGatewayErrorKind;

export interface AiGatewayErrorDetails {
  usage?: AiUsage | null;
  cost?: AiCost | null;
  stopReason?: AiGatewayStopReason | null;
}

export interface AiGateway {
  stream: (input: AiGatewayInput) => AsyncGenerator<AiGatewayEvent>;
}
