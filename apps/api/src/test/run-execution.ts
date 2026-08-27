import {
  createRunExecutionContext,
  type RunExecutionContext,
} from "@api/infra/agent/run-execution-context.js";
import { generateId } from "@api/shared/id.js";

/**
 * 测试用的 Run 关联上下文。
 *
 * 生产代码里它由 Run Service 创建；单元测试只需要一个带默认 principal 和 scope
 * 的实例，再按需覆盖 runId、sessionId 或 principal。
 */
export function testRunExecution(
  overrides: Partial<Parameters<typeof createRunExecutionContext>[0]> = {},
): RunExecutionContext {
  return createRunExecutionContext({
    runId: generateId(),
    sessionId: generateId(),
    lane: "main",
    requestId: "request-1",
    principal: {
      kind: "starter_user",
      principalId: "user-1",
      tenantId: "starter",
      projectId: "starter",
      externalUserId: "user-1",
      appId: null,
    },
    scope: {
      tenantId: "starter",
      projectId: "starter",
      subjectType: null,
      subjectId: null,
    },
    agentId: generateId(),
    agentRevision: 1,
    ...overrides,
  });
}
