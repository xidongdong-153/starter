import { ApiErrorCodes } from "@starter/contracts";
import type { ZodType } from "zod";

import { AppError } from "./app-error.js";
import { parseBoundedJson } from "./bounded-json.js";

/** 数据损坏原因；只保留可安全记日志的分类和字段路径。 */
export interface StoredJsonIssue {
  path: string;
  code: string;
}

/**
 * 主库 `*_json` 列解析失败。
 *
 * `column` 和 `issues` 只用于服务端日志，不进入 HTTP 响应；`issues` 只带
 * 字段路径和 Zod issue code，不带被拒绝的值本身。
 */
export class StoredJsonError extends AppError {
  constructor(
    readonly column: string,
    readonly reason: "invalid_json" | "schema_mismatch",
    readonly issues: readonly StoredJsonIssue[] = [],
  ) {
    super(ApiErrorCodes.SYSTEM_INTERNAL_ERROR, "存储数据无效", 500);
    this.name = "StoredJsonError";
  }
}

/**
 * 读取主库 JSON 列：先按深度上限解析，再用 `packages/contracts` 的共享 schema 校验。
 * 语法错误和 schema 不匹配都按数据损坏处理，抛稳定错误，不降级成空对象或 `as` 断言。
 */
export function parseStoredJson<T>(input: {
  column: string;
  json: string;
  schema: ZodType<T>;
}): T {
  let value: unknown;
  try {
    value = parseBoundedJson(input.json);
  } catch {
    throw new StoredJsonError(input.column, "invalid_json");
  }
  const parsed = input.schema.safeParse(value);
  if (!parsed.success) {
    throw new StoredJsonError(
      input.column,
      "schema_mismatch",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
      })),
    );
  }
  return parsed.data;
}
