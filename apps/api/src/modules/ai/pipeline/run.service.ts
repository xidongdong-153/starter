import type { Logger } from "pino";
import type { Entry } from "@earendil-works/pi-agent-core";
import type {
  ApiErrorCode,
  PipelineDefinitionDetail,
  PipelineRun,
  PipelineRunAbort,
  PipelineRunStepState,
} from "@starter/contracts";
import { ApiErrorCodes, pipelineRunStepStateSchema } from "@starter/contracts";
import { z } from "zod";

import type { AgentSessionStore } from "@api/infra/agent/index.js";
import { AppError } from "@api/shared/app-error.js";
import { generateId } from "@api/shared/id.js";
import { parseStoredJson } from "@api/shared/stored-json.js";
import type { RuntimeAccessContext } from "@api/modules/ai/principal.js";
import type { AiStructuredOutputRepository } from "../output/structured-output.repository.js";
import type { AiAgentSessionService } from "../session/session.service.js";
import {
  assistantContentToString,
  resolveRunId,
} from "../session/session.presenter.js";
import type { AiAgentRunService } from "../run/run.service.js";
import type { AiPipelineDefinitionService } from "./definition.service.js";
import type {
  AiPipelineRunRecord,
  AiPipelineRunRepository,
} from "./run.repository.js";
import { renderTemplate } from "./template.js";

/** DTO 侧步骤产出截断上限；全量事实在 transcript（用步骤 runId 可查）。 */
const STEP_OUTPUT_DTO_LIMIT = 1000;
const STEP_OUTPUT_TRUNCATION_MARK = "…（已截断，全量见 transcript）";

const stepsStateSchema = z.array(pipelineRunStepStateSchema);

export interface PipelineRunRecoveryReport {
  scanned: number;
  interrupted: number;
}

export interface AiPipelineRunService {
  start: (input: {
    access: RuntimeAccessContext;
    pipelineId: string;
    input: string;
    requestId: string;
  }) => Promise<{ runId: string }>;
  get: (access: RuntimeAccessContext, id: string) => PipelineRun;
  abort: (access: RuntimeAccessContext, id: string) => PipelineRunAbort;
  /** 启动扫描：running 行全部转 failed + AI.RUN_INTERRUPTED，不自动续跑。 */
  recoverInterrupted: () => Promise<PipelineRunRecoveryReport>;
}

/**
 * Pipeline 编排：每步一个标准 Agent Run（复用 runService.startRun 全套），
 * 上一步产出渲染进下一步输入，串行推进到终态。
 *
 * pipeline 行的写入者只有编排循环与恢复扫描，均使用条件更新（仅 running 可变终态），
 * 两层互不覆盖。abort 端点只透传 runService.abort + 内存标记，不直接写终态。
 */
export function createAiPipelineRunService(input: {
  repository: AiPipelineRunRepository;
  definitionService: AiPipelineDefinitionService;
  sessionService: AiAgentSessionService;
  runService: AiAgentRunService;
  structuredOutputRepository: AiStructuredOutputRepository;
  /** 步骤产出兜底提取：读 lane transcript 的 assistant 文本。 */
  sessionStore: AgentSessionStore;
  logger: Logger;
}): AiPipelineRunService {
  const {
    repository,
    definitionService,
    sessionService,
    runService,
    structuredOutputRepository,
    sessionStore,
    logger,
  } = input;
  /** 正在执行的步骤 Run（pipelineRunId -> agent runId），abort 端点读。 */
  const currentRuns = new Map<string, string>();
  /** 步骤间隙收到的 abort 请求，编排循环下一轮开始前消费。 */
  const abortRequests = new Set<string>();

  async function start(startInput: {
    access: RuntimeAccessContext;
    pipelineId: string;
    input: string;
    requestId: string;
  }): Promise<{ runId: string }> {
    const { access, pipelineId, requestId } = startInput;
    const pipeline = definitionService.getEnabled(pipelineId);
    const session = await sessionService.create(
      { title: `Pipeline: ${pipeline.name}` },
      access,
      requestId,
    );
    const pipelineRunId = generateId();
    try {
      repository.create({
        id: pipelineRunId,
        pipelineId: pipeline.id,
        pipelineRevision: pipeline.revision,
        access,
        sessionId: session.id,
        input: startInput.input,
        requestId,
        now: new Date(),
      });
    } catch (cause) {
      logger.error(
        { err: cause, pipelineRunId, pipelineId, requestId },
        "Pipeline Run row 创建失败",
      );
      throw new AppError(
        ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
        "创建 Pipeline Run 失败",
        500,
      );
    }

    void executeLoop({
      pipelineRunId,
      access,
      pipeline,
      sessionId: session.id,
      pipelineInput: startInput.input,
      requestId,
    });
    return { runId: pipelineRunId };
  }

  /**
   * 编排循环：渲染 -> startRun -> 迭代事件认 terminal -> Run 行终态兜底 ->
   * 提取产出 -> 写步骤明细 -> 推进或终态。fail fast：某步失败后续步骤不启动。
   */
  async function executeLoop(loopInput: {
    pipelineRunId: string;
    access: RuntimeAccessContext;
    pipeline: PipelineDefinitionDetail;
    sessionId: string;
    pipelineInput: string;
    requestId: string;
  }): Promise<void> {
    const {
      pipelineRunId,
      access,
      pipeline,
      sessionId,
      pipelineInput,
      requestId,
    } = loopInput;
    const logContext = {
      pipelineRunId,
      pipelineId: pipeline.id,
      sessionId,
      requestId,
    };
    const outputs: string[] = [];
    const stepStates: PipelineRunStepState[] = [];

    try {
      for (const [index, step] of pipeline.steps.entries()) {
        // 步骤间隙收到的 abort：不再启动下一步。
        if (abortRequests.has(pipelineRunId)) {
          await finishTerminal(pipelineRunId, "aborted", null, null);
          return;
        }
        const lane = `pipeline-${index}`;
        const stepInput = renderTemplate(step.inputTemplate, {
          input: pipelineInput,
          outputs,
        });

        let runId: string;
        try {
          const started = await runService.startRun({
            access,
            sessionId,
            input: { agentId: step.agentId, lane, input: stepInput },
            requestId,
          });
          runId = started.runId;
        } catch (cause) {
          // 步骤 Run 未启动（agent 解析失败、lane busy、存储失败等）：
          // 无步骤明细可写，errorCode 透传，pipeline 直接 failed。
          const errorCode =
            cause instanceof AppError
              ? cause.code
              : ApiErrorCodes.SYSTEM_INTERNAL_ERROR;
          logger.warn(
            { ...logContext, stepIndex: index, err: cause, errorCode },
            "Pipeline 步骤 Run 启动失败，流水线终止",
          );
          await finishTerminal(pipelineRunId, "failed", null, errorCode);
          return;
        }

        currentRuns.set(pipelineRunId, runId);
        try {
          // 持续消费事件防队列积压；只认 terminal 提前退出，其余读完即丢。
          for await (const event of runService.subscribe(
            access,
            sessionId,
            runId,
            0,
          )) {
            if (
              event.type === "run.completed" ||
              event.type === "run.failed" ||
              event.type === "run.aborted"
            ) {
              break;
            }
          }
        } catch (cause) {
          // 事件读取失败不判死：Run 行终态才是唯一持久事实。
          logger.warn(
            { ...logContext, stepIndex: index, runId, err: cause },
            "Pipeline 步骤事件流读取中断，回落 Run 行终态",
          );
        }
        currentRuns.delete(pipelineRunId);

        // 终态兜底：事件队列溢出关闭时 terminal 事件可能没送达，以 Run 行为准。
        const run = runService.get(access, sessionId, runId);
        const output =
          run.status === "completed"
            ? await extractStepOutput({
                runId,
                sessionId,
                lane,
              })
            : null;
        const stepState: PipelineRunStepState = {
          index,
          agentId: step.agentId,
          agentRevision: run.agentRevision,
          runId,
          lane,
          status: run.status,
          output,
          errorCode: run.errorCode,
          startedAt: run.startedAt ?? null,
          finishedAt: run.finishedAt ?? null,
        };
        stepStates.push(stepState);
        try {
          repository.updateStepState(pipelineRunId, JSON.stringify(stepStates));
        } catch (cause) {
          logger.error(
            { ...logContext, stepIndex: index, err: cause },
            "Pipeline 步骤明细写入失败",
          );
        }

        if (run.status === "aborted") {
          await finishTerminal(pipelineRunId, "aborted", null, null);
          return;
        }
        if (run.status !== "completed") {
          await finishTerminal(
            pipelineRunId,
            "failed",
            null,
            run.errorCode ?? ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
          );
          return;
        }
        outputs.push(output ?? "");
      }

      await finishTerminal(
        pipelineRunId,
        "completed",
        outputs.at(-1) ?? "",
        null,
      );
    } catch (cause) {
      logger.error({ ...logContext, err: cause }, "Pipeline 编排循环异常终止");
      await finishTerminal(
        pipelineRunId,
        "failed",
        null,
        ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
      );
    } finally {
      currentRuns.delete(pipelineRunId);
      abortRequests.delete(pipelineRunId);
    }
  }

  /**
   * 步骤产出提取：结构化输出优先（最后一条 value JSON 序列化），
   * 无结构化输出时读 lane transcript 里该 Run 的最后一条 assistant 文本。
   */
  async function extractStepOutput(stepInput: {
    runId: string;
    sessionId: string;
    lane: string;
  }): Promise<string> {
    const structured = structuredOutputRepository.listByRun(stepInput.runId);
    if (structured.length > 0) {
      const last = structured[structured.length - 1]!;
      return JSON.stringify(last.value);
    }
    let entries: Entry[];
    try {
      entries = await sessionStore.readTranscript({
        sessionId: stepInput.sessionId,
        lane: stepInput.lane,
        order: "newestFirst",
      });
    } catch (cause) {
      logger.error(
        {
          err: cause,
          runId: stepInput.runId,
          sessionId: stepInput.sessionId,
          lane: stepInput.lane,
        },
        "Pipeline 步骤产出读取 transcript 失败",
      );
      return "";
    }
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (message.role !== "assistant") continue;
      if (resolveRunId(message) !== stepInput.runId) continue;
      return assistantContentToString(message.content);
    }
    return "";
  }

  /** 终态写入 + 内存清理；条件更新失败（已被恢复扫描处置）只记日志。 */
  async function finishTerminal(
    pipelineRunId: string,
    status: "completed" | "failed" | "aborted",
    finalOutput: string | null,
    errorCode: ApiErrorCode | null,
  ): Promise<void> {
    try {
      const committed = repository.updateTerminal({
        id: pipelineRunId,
        status,
        finalOutput,
        errorCode,
        finishedAt: new Date(),
      });
      if (!committed) {
        logger.warn(
          { pipelineRunId, status },
          "Pipeline Run 终态更新未提交（行已不在 running 状态）",
        );
      }
    } catch (cause) {
      logger.error(
        { err: cause, pipelineRunId, status },
        "Pipeline Run 终态写入失败",
      );
    }
  }

  function get(access: RuntimeAccessContext, id: string): PipelineRun {
    const record = repository.findInScope(id, access);
    if (!record) throw notFound();
    return toPipelineRunDto(record);
  }

  function abort(access: RuntimeAccessContext, id: string): PipelineRunAbort {
    const record = repository.findInScope(id, access);
    if (!record) throw notFound();
    if (record.status !== "running") {
      throw new AppError(
        ApiErrorCodes.AI_RUN_NOT_ACTIVE,
        "Pipeline Run 当前不在运行状态",
        409,
      );
    }
    const currentRunId = currentRuns.get(record.id);
    if (currentRunId) {
      try {
        runService.abort(access, record.sessionId, currentRunId);
      } catch (cause) {
        // 步骤刚进终态（间隙窗口）：标记 abort，循环下一轮不再启动下一步。
        if (
          cause instanceof AppError &&
          cause.code === ApiErrorCodes.AI_RUN_NOT_ACTIVE
        ) {
          abortRequests.add(record.id);
        } else {
          throw cause;
        }
      }
    } else {
      abortRequests.add(record.id);
    }
    return { runId: record.id, status: record.status };
  }

  async function recoverInterrupted(): Promise<PipelineRunRecoveryReport> {
    const rows = repository.listByStatus("running");
    let interrupted = 0;
    for (const row of rows) {
      const committed = repository.updateTerminal({
        id: row.id,
        status: "failed",
        finalOutput: null,
        errorCode: ApiErrorCodes.AI_RUN_INTERRUPTED,
        finishedAt: new Date(),
      });
      if (committed) {
        interrupted += 1;
        logger.warn(
          { pipelineRunId: row.id, pipelineId: row.pipelineId },
          "Pipeline Run 进程中断，恢复扫描标记 failed（不自动续跑）",
        );
      }
    }
    return { scanned: rows.length, interrupted };
  }

  function notFound(): AppError {
    return new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "资源不存在", 404);
  }

  return { start, get, abort, recoverInterrupted };
}

function toPipelineRunDto(record: AiPipelineRunRecord): PipelineRun {
  const states = parseStepsState(record.stepsStateJson);
  return {
    id: record.id,
    pipelineId: record.pipelineId,
    pipelineRevision: record.pipelineRevision,
    sessionId: record.sessionId,
    status: record.status as PipelineRun["status"],
    steps: states.map((step) => ({
      ...step,
      output: truncateStepOutput(step.output),
    })),
    finalOutput: record.finalOutput,
    errorCode: record.errorCode as ApiErrorCode | null,
    requestId: record.requestId,
    createdAt: record.createdAt.toISOString(),
    startedAt: record.startedAt?.toISOString() ?? null,
    finishedAt: record.finishedAt?.toISOString() ?? null,
  };
}

function parseStepsState(stepsStateJson: string): PipelineRunStepState[] {
  return parseStoredJson({
    column: "ai_pipeline_runs.steps_state_json",
    json: stepsStateJson,
    schema: stepsStateSchema,
  });
}

function truncateStepOutput(output: string | null): string | null {
  if (output === null) return null;
  if (output.length <= STEP_OUTPUT_DTO_LIMIT) return output;
  return `${output.slice(0, STEP_OUTPUT_DTO_LIMIT)}${STEP_OUTPUT_TRUNCATION_MARK}`;
}
