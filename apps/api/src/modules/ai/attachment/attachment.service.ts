import type { StorageDriver } from "@api/infra/storage/index.js";
import type { RuntimeAccessContext } from "@api/modules/ai/principal.js";
import type { AiAgentSessionRepository } from "@api/modules/ai/session/index.js";
import type { AiAttachment, AiAttachmentMimeType } from "@starter/contracts";
import { aiAttachmentMimeTypeSchema, ApiErrorCodes } from "@starter/contracts";
import type {
  AiAttachmentRecord,
  AiAttachmentRepository,
} from "./attachment.repository.js";
import { AppError } from "@api/shared/app-error.js";

const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;

export interface AiAttachmentContent {
  bytes: Uint8Array;
  mimeType: AiAttachmentMimeType;
  size: number;
}

export function createAiAttachmentService(deps: {
  storage: StorageDriver;
  repository: AiAttachmentRepository;
  sessionRepository: AiAgentSessionRepository;
}) {
  function attachmentNotFound(): AppError {
    return new AppError(
      ApiErrorCodes.AI_ATTACHMENT_NOT_FOUND,
      "附件不存在",
      404,
    );
  }

  async function upload(input: {
    access: RuntimeAccessContext;
    file: File;
    sessionId: string | null;
  }): Promise<AiAttachment> {
    const { access, file, sessionId } = input;

    const mimeType = aiAttachmentMimeTypeSchema.safeParse(file.type);
    if (!mimeType.success) {
      throw new AppError(
        ApiErrorCodes.AI_ATTACHMENT_TYPE_NOT_ALLOWED,
        "只支持 JPEG、PNG、WebP、GIF 格式的图片",
        400,
      );
    }
    if (file.size <= 0) {
      throw new AppError(
        ApiErrorCodes.COMMON_INVALID_REQUEST,
        "图片内容为空",
        400,
      );
    }
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new AppError(
        ApiErrorCodes.AI_ATTACHMENT_TOO_LARGE,
        "图片不能超过 5MB",
        400,
      );
    }
    if (sessionId !== null) {
      const session = deps.sessionRepository.findInScope(sessionId, access);
      if (!session) {
        throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "会话不存在", 404);
      }
    }

    const { principal } = access;
    const stored = await deps.storage.write(
      principal.principalId,
      file.name,
      new Uint8Array(await file.arrayBuffer()),
    );
    try {
      const record = await deps.repository.create({
        id: stored.fileId,
        ownerUserId:
          principal.kind === "starter_user" ? principal.principalId : null,
        appId: principal.kind === "product_app" ? principal.appId : null,
        principalKind: principal.kind,
        sessionId,
        mimeType: mimeType.data,
        size: file.size,
        storagePath: stored.relative,
        createdAt: new Date(),
      });
      return toAiAttachment(record);
    } catch (error) {
      await deps.storage.remove(stored.relative).catch(() => undefined);
      throw error;
    }
  }

  async function readContent(
    access: RuntimeAccessContext,
    attachmentId: string,
  ): Promise<AiAttachmentContent> {
    const record = await deps.repository.findById(attachmentId);
    if (!record || !isAiAttachmentOwnedBy(record, access))
      throw attachmentNotFound();

    let bytes: Uint8Array;
    try {
      bytes = await deps.storage.read(record.storagePath);
    } catch {
      throw attachmentNotFound();
    }
    return {
      bytes,
      mimeType: parseMimeType(record),
      size: record.size,
    };
  }

  async function remove(
    access: RuntimeAccessContext,
    attachmentId: string,
  ): Promise<{ ok: true }> {
    const record = await deps.repository.findById(attachmentId);
    if (!record || !isAiAttachmentOwnedBy(record, access))
      throw attachmentNotFound();
    await deps.repository.deleteById(attachmentId);
    await deps.storage.remove(record.storagePath).catch(() => undefined);
    return { ok: true };
  }

  function parseMimeType(record: AiAttachmentRecord): AiAttachmentMimeType {
    return aiAttachmentMimeTypeSchema.parse(record.mimeType);
  }

  function toAiAttachment(record: AiAttachmentRecord): AiAttachment {
    return {
      id: record.id,
      mimeType: parseMimeType(record),
      size: record.size,
      sessionId: record.sessionId,
      createdAt: record.createdAt.toISOString(),
    };
  }

  return { readContent, remove, upload };
}

export type AiAttachmentService = ReturnType<typeof createAiAttachmentService>;

/** 附件归属判据：starter_user 比对 ownerUserId，product_app 比对 appId；resolver 复用同一判据。 */
export function isAiAttachmentOwnedBy(
  record: AiAttachmentRecord,
  access: RuntimeAccessContext,
): boolean {
  if (access.principal.kind === "starter_user") {
    return (
      record.principalKind === "starter_user" &&
      record.ownerUserId === access.principal.principalId
    );
  }
  return (
    record.principalKind === "product_app" &&
    record.appId !== null &&
    record.appId === access.principal.appId
  );
}
