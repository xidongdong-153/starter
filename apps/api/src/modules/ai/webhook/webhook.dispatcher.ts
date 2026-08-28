import { createHmac } from "node:crypto";
import type { Logger } from "pino";
import { webhookRunTerminalPayloadSchema } from "@starter/contracts";
import type { AppDatabase } from "@api/infra/db/client.js";
import { AiUrlGuardError } from "@api/infra/ai/index.js";
import { generateId } from "@api/shared/id.js";
import {
  createAiWebhookRepository,
  type AiWebhookEndpointRecord,
  type DueDeliveryRow,
  type TerminalProductAppRunRow,
} from "./webhook.repository.js";
import type { WebhookCrypto } from "./webhook.crypto.js";

const ENQUEUE_BATCH_LIMIT = 200;
const DELIVER_BATCH_LIMIT = 50;
const LAST_ERROR_MAX_LENGTH = 500;

export interface AiWebhookDispatcherSettings {
  sweepIntervalMs: number;
  maxAttempts: number;
  backoffMs: readonly number[];
}

export interface AiWebhookDispatcherDeps {
  db: AppDatabase;
  crypto: WebhookCrypto;
  /** 出站请求的唯一通道，自带 DNS pin、内网拒绝、重定向拒绝和超时。 */
  urlGuard: {
    fetch: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;
  };
  logger: Logger;
  settings: AiWebhookDispatcherSettings;
}

export interface AiWebhookDispatcher {
  start: () => void;
  stop: () => void;
  tick: () => Promise<void>;
}

/**
 * 签名头 `X-Starter-Signature` 的值：`t=<unix秒>,v1=<hmac_hex>`。
 * `v1 = HMAC-SHA256("<t>." + body, signingSecret)`。
 */
export function signWebhookPayload(
  secret: string,
  timestampSec: number,
  body: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestampSec}.${body}`, "utf8")
    .digest("hex");
  return `t=${timestampSec},v1=${digest}`;
}

/**
 * Webhook 投递器：周期 tick 内先补登终态 Run，再投递到期记录。
 *
 * 不订阅 RunService 事件，也不参与终态事务；终态事实从 `ai_agent_runs`
 * 行上扫描。进程重启后内存水位从 0 开始，按同一规则补发漏掉的终态 Run。
 */
export function createAiWebhookDispatcher(
  deps: AiWebhookDispatcherDeps,
): AiWebhookDispatcher {
  const { db, crypto, urlGuard, logger, settings } = deps;
  const repository = createAiWebhookRepository(db);
  const backoffMs = settings.backoffMs.length > 0 ? settings.backoffMs : [0];
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  let lastSweptFinishedAt = 0;

  function start(): void {
    if (timer) return;
    void tick();
    timer = setInterval(() => void tick(), settings.sweepIntervalMs);
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      // 两个阶段各自捕获：补登失败只阻塞水位推进，不影响已入队记录的投递。
      try {
        await enqueuePhase();
      } catch (error) {
        logger.error({ err: error }, "Webhook 补登阶段异常，水位不推进");
      }
      await deliverPhase();
    } catch (error) {
      logger.error({ err: error }, "Webhook tick 异常");
    } finally {
      ticking = false;
    }
  }

  async function enqueuePhase(): Promise<void> {
    const runs = repository.listTerminalProductAppRunsAfter(
      lastSweptFinishedAt,
      ENQUEUE_BATCH_LIMIT,
    );
    if (runs.length === 0) return;
    const endpointsByApp = groupEndpointsByApp(
      repository.listEnabledEndpoints(),
    );
    const now = new Date();
    let maxFinishedAt = lastSweptFinishedAt;
    for (const run of runs) {
      const payloadJson = buildPayloadJson(run, now);
      for (const endpoint of endpointsByApp.get(run.appId) ?? []) {
        // 端点创建之前的 Run 不补发。
        if (run.finishedAt.getTime() < endpoint.createdAt.getTime()) continue;
        repository.insertDeliveryIgnore({
          id: generateId(),
          endpointId: endpoint.id,
          appId: run.appId,
          runId: run.id,
          eventType: "run.terminal",
          payloadJson,
          status: "pending",
          attempts: 0,
          nextAttemptAt: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      maxFinishedAt = Math.max(maxFinishedAt, run.finishedAt.getTime());
    }
    // 全部入队成功才推进水位；中途抛异常时水位不动，下一 tick 重扫（幂等）。
    lastSweptFinishedAt = maxFinishedAt;
  }

  async function deliverPhase(): Promise<void> {
    const due = repository.listDueDeliveries(DELIVER_BATCH_LIMIT, new Date());
    for (const item of due) {
      try {
        await deliverOne(item);
      } catch (error) {
        logger.error(
          {
            deliveryId: item.delivery.id,
            endpointId: item.delivery.endpointId,
            runId: item.delivery.runId,
            err: error,
          },
          "Webhook 投递记录处理异常",
        );
      }
    }
  }

  async function deliverOne(item: DueDeliveryRow): Promise<void> {
    const { delivery } = item;
    const now = new Date();
    const timestampSec = Math.floor(now.getTime() / 1000);
    const body = delivery.payloadJson;

    let secret: string;
    try {
      secret = crypto.decryptSecret(item.signingSecretEncrypted);
    } catch {
      repository.markDead(delivery.id, now, null, "secret_decrypt_failed");
      logger.warn(
        { deliveryId: delivery.id, endpointId: delivery.endpointId },
        "Webhook signing secret 解密失败，投递进入死信",
      );
      return;
    }

    const signature = signWebhookPayload(secret, timestampSec, body);
    try {
      const response = await urlGuard.fetch(item.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "starter-webhook/1",
          "X-Starter-Event": delivery.eventType,
          "X-Starter-Timestamp": String(timestampSec),
          "X-Starter-Signature": signature,
        },
        body,
      });
      if (response.status >= 200 && response.status < 300) {
        repository.markDelivered(delivery.id, now, response.status);
        repository.touchLastDelivery(delivery.endpointId, now);
        return;
      }
      retryOrDead(item, now, response.status, `http_${response.status}`);
    } catch (error) {
      if (error instanceof AiUrlGuardError) {
        // URL 变内网、不可达、被重定向等配置性失败，重试无意义，直接死信。
        repository.markDead(delivery.id, now, null, `guard:${error.reason}`);
        logger.warn(
          {
            deliveryId: delivery.id,
            endpointId: delivery.endpointId,
            runId: delivery.runId,
            reason: error.reason,
          },
          "Webhook URL 被 guard 拒绝，投递进入死信",
        );
        return;
      }
      retryOrDead(item, now, null, errorMessage(error));
    }
  }

  function retryOrDead(
    item: DueDeliveryRow,
    now: Date,
    responseCode: number | null,
    errorText: string,
  ): void {
    const { delivery } = item;
    const attempts = delivery.attempts + 1;
    if (attempts >= settings.maxAttempts) {
      repository.markDead(delivery.id, now, responseCode, truncate(errorText));
      logger.warn(
        {
          deliveryId: delivery.id,
          endpointId: delivery.endpointId,
          runId: delivery.runId,
          attempts,
          responseCode,
          error: truncate(errorText),
        },
        "Webhook 投递达到最大尝试次数，进入死信",
      );
      return;
    }
    const backoff =
      backoffMs[Math.min(attempts - 1, backoffMs.length - 1)] ?? 0;
    repository.markRetry(
      delivery.id,
      now,
      new Date(now.getTime() + backoff),
      responseCode,
      truncate(errorText),
    );
    logger.warn(
      {
        deliveryId: delivery.id,
        endpointId: delivery.endpointId,
        runId: delivery.runId,
        attempts,
        responseCode,
        error: truncate(errorText),
        nextAttemptInMs: backoff,
      },
      "Webhook 投递失败，等待退避后重试",
    );
  }

  return { start, stop, tick };
}

function groupEndpointsByApp(
  endpoints: AiWebhookEndpointRecord[],
): Map<string, AiWebhookEndpointRecord[]> {
  const result = new Map<string, AiWebhookEndpointRecord[]>();
  for (const endpoint of endpoints) {
    const group = result.get(endpoint.appId);
    if (group) group.push(endpoint);
    else result.set(endpoint.appId, [endpoint]);
  }
  return result;
}

function buildPayloadJson(run: TerminalProductAppRunRow, now: Date): string {
  const payload = webhookRunTerminalPayloadSchema.parse({
    type: "run.terminal",
    appId: run.appId,
    runId: run.id,
    sessionId: run.sessionId,
    lane: run.lane,
    agentId: run.agentId,
    agentRevision: run.agentRevision,
    status: run.status,
    errorCode: run.errorCode,
    finishedAt: run.finishedAt.toISOString(),
    occurredAt: now.toISOString(),
  });
  return JSON.stringify(payload);
}

function truncate(value: string): string {
  return value.length > LAST_ERROR_MAX_LENGTH
    ? value.slice(0, LAST_ERROR_MAX_LENGTH)
    : value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
