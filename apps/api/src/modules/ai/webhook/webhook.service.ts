import type {
  AiWebhookDeliveryList,
  AiWebhookDeliveryQuery,
  AiWebhookEndpoint,
  AiWebhookEndpointSecret,
  AiWebhookTestResult,
  CreateAiWebhookEndpointInput,
  UpdateAiWebhookEndpointInput,
} from "@starter/contracts";
import { ApiErrorCodes } from "@starter/contracts";
import type { Logger } from "pino";
import { AppError } from "@api/shared/app-error.js";
import { generateId } from "@api/shared/id.js";
import { AiUrlGuardError } from "@api/infra/ai/index.js";
import {
  createWebhookSigningSecret,
  type WebhookCrypto,
} from "./webhook.crypto.js";
import type {
  AiWebhookDeliveryRecord,
  AiWebhookEndpointRecord,
  AiWebhookRepository,
} from "./webhook.repository.js";
import { signWebhookPayload } from "./webhook.dispatcher.js";

function appNotFound(): AppError {
  return new AppError(
    ApiErrorCodes.AI_APP_CREDENTIAL_NOT_FOUND,
    "应用凭据不存在",
    404,
  );
}

function endpointNotFound(): AppError {
  return new AppError(
    ApiErrorCodes.AI_WEBHOOK_ENDPOINT_NOT_FOUND,
    "Webhook 端点不存在",
    404,
  );
}

function credentialKeyUnavailable(): AppError {
  return new AppError(
    ApiErrorCodes.AI_CREDENTIAL_KEY_UNAVAILABLE,
    "API 未配置 AI 凭据加密密钥，无法保存 Webhook signing secret",
    503,
  );
}

export function toWebhookEndpoint(
  record: AiWebhookEndpointRecord,
): AiWebhookEndpoint {
  return {
    endpointId: record.id,
    appId: record.appId,
    url: record.url,
    status: record.status as AiWebhookEndpoint["status"],
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    lastDeliveryAt: record.lastDeliveryAt?.toISOString() ?? null,
  };
}

function toWebhookDelivery(
  record: AiWebhookDeliveryRecord,
): AiWebhookDeliveryList["items"][number] {
  return {
    id: record.id,
    endpointId: record.endpointId,
    appId: record.appId,
    runId: record.runId,
    eventType: record.eventType,
    status: record.status as AiWebhookDeliveryList["items"][number]["status"],
    attempts: record.attempts,
    nextAttemptAt: record.nextAttemptAt?.toISOString() ?? null,
    lastResponseCode: record.lastResponseCode,
    lastError: record.lastError,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deliveredAt: record.deliveredAt?.toISOString() ?? null,
    deadAt: record.deadAt?.toISOString() ?? null,
  };
}

export function createAiWebhookService(input: {
  repository: AiWebhookRepository;
  /** 应用凭据存在性检查，端点挂在应用凭据下。 */
  applicationRepository: {
    findById: (appId: string) => unknown;
  };
  crypto: WebhookCrypto;
  /** 出站 URL 检查与请求共用同一 guard；test 探测的超时与正式投递一致。 */
  urlGuard: {
    assertAllowed: (input: string | URL) => Promise<URL>;
    fetch: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;
  };
  logger: Logger;
}) {
  const { repository, applicationRepository, crypto, urlGuard, logger } = input;

  async function assertAllowedUrl(url: string): Promise<string> {
    try {
      return (await urlGuard.assertAllowed(url)).toString();
    } catch (error) {
      if (error instanceof AiUrlGuardError) {
        throw new AppError(
          ApiErrorCodes.AI_CONFIG_INVALID,
          `Webhook URL 不允许（${error.reason}）`,
          400,
        );
      }
      throw error;
    }
  }

  function requireApp(appId: string): void {
    if (!applicationRepository.findById(appId)) throw appNotFound();
  }

  function requireEndpoint(endpointId: string): AiWebhookEndpointRecord {
    const record = repository.findEndpointById(endpointId);
    if (!record) throw endpointNotFound();
    return record;
  }

  async function createEndpoint(
    data: CreateAiWebhookEndpointInput,
    actorId: string,
  ): Promise<AiWebhookEndpointSecret> {
    requireApp(data.appId);
    const url = await assertAllowedUrl(data.url);
    if (!crypto.available) throw credentialKeyUnavailable();
    const signingSecret = createWebhookSigningSecret();
    const now = new Date();
    const record = repository.createEndpoint({
      id: generateId(),
      appId: data.appId,
      url,
      signingSecretEncrypted: crypto.encryptSecret(signingSecret),
      status: "enabled",
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now,
      lastDeliveryAt: null,
    });
    logger.info(
      { endpointId: record.id, appId: data.appId },
      "Webhook 端点已创建",
    );
    return { endpoint: toWebhookEndpoint(record), signingSecret };
  }

  function listEndpoints(appId: string): AiWebhookEndpoint[] {
    requireApp(appId);
    return repository.listEndpointsByApp(appId).map(toWebhookEndpoint);
  }

  async function updateEndpoint(
    endpointId: string,
    data: UpdateAiWebhookEndpointInput,
    actorId: string,
  ): Promise<AiWebhookEndpoint> {
    requireEndpoint(endpointId);
    const url =
      data.url !== undefined ? await assertAllowedUrl(data.url) : undefined;
    const record = repository.updateEndpoint(
      endpointId,
      {
        ...(url !== undefined ? { url } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
      actorId,
      new Date(),
    );
    if (!record) throw endpointNotFound();
    return toWebhookEndpoint(record);
  }

  function rotateEndpoint(
    endpointId: string,
    actorId: string,
  ): AiWebhookEndpointSecret {
    requireEndpoint(endpointId);
    if (!crypto.available) throw credentialKeyUnavailable();
    const signingSecret = createWebhookSigningSecret();
    const record = repository.replaceEndpointSecret(
      endpointId,
      crypto.encryptSecret(signingSecret),
      actorId,
      new Date(),
    );
    if (!record) throw endpointNotFound();
    logger.info({ endpointId }, "Webhook 端点 secret 已轮换");
    return { endpoint: toWebhookEndpoint(record), signingSecret };
  }

  function deleteEndpoint(endpointId: string): AiWebhookEndpoint {
    const record = requireEndpoint(endpointId);
    repository.deleteEndpoint(endpointId);
    logger.info({ endpointId }, "Webhook 端点已删除");
    return toWebhookEndpoint(record);
  }

  async function testEndpoint(
    endpointId: string,
  ): Promise<AiWebhookTestResult> {
    const record = requireEndpoint(endpointId);
    let secret: string;
    try {
      secret = crypto.decryptSecret(record.signingSecretEncrypted);
    } catch {
      return { ok: false, responseCode: null, error: "secret_decrypt_failed" };
    }
    const timestampSec = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      type: "webhook.test",
      appId: record.appId,
      endpointId: record.id,
      sentAt: new Date(timestampSec * 1000).toISOString(),
    });
    try {
      const response = await urlGuard.fetch(record.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "starter-webhook/1",
          "X-Starter-Event": "webhook.test",
          "X-Starter-Timestamp": String(timestampSec),
          "X-Starter-Signature": signWebhookPayload(secret, timestampSec, body),
        },
        body,
      });
      if (response.status >= 200 && response.status < 300) {
        return { ok: true, responseCode: response.status, error: null };
      }
      return {
        ok: false,
        responseCode: response.status,
        error: `http_${response.status}`,
      };
    } catch (error) {
      const message =
        error instanceof AiUrlGuardError
          ? `guard:${error.reason}`
          : error instanceof Error
            ? error.message
            : String(error);
      return { ok: false, responseCode: null, error: message };
    }
  }

  function listDeliveries(
    query: AiWebhookDeliveryQuery,
  ): AiWebhookDeliveryList {
    const page = repository.listDeliveries(query);
    return {
      items: page.items.map(toWebhookDelivery),
      total: page.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  return {
    createEndpoint,
    listEndpoints,
    updateEndpoint,
    rotateEndpoint,
    deleteEndpoint,
    testEndpoint,
    listDeliveries,
  };
}

export type AiWebhookService = ReturnType<typeof createAiWebhookService>;
