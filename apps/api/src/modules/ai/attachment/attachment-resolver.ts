import type { AiAttachmentMimeType } from "@starter/contracts";
import { aiAttachmentMimeTypeSchema, ApiErrorCodes } from "@starter/contracts";

import type { StorageDriver } from "@api/infra/storage/index.js";
import type { RuntimeAccessContext } from "@api/modules/ai/principal.js";
import { AppError } from "@api/shared/app-error.js";
import type { AiAttachmentRepository } from "./attachment.repository.js";
import { isAiAttachmentOwnedBy } from "./attachment.service.js";

/** 单次请求允许携带的附件数量；contracts schema 已拦截，这里防御重复。 */
const MAX_ATTACHMENTS_PER_REQUEST = 4;

/** 解析后的图片附件：data 为 base64，只在内存与模型请求中存在。 */
export interface ResolvedAiImageAttachment {
  attachmentId: string;
  mimeType: AiAttachmentMimeType;
  data: string;
}

export interface AiAttachmentResolver {
  /**
   * 按 attachmentIds 批量解析附件：校验 principal 归属与 session 归属，
   * 读磁盘字节并转 base64。任何一条失败抛 AI_ATTACHMENT_NOT_FOUND。
   */
  resolveForRequest: (input: {
    access: RuntimeAccessContext;
    /** run 类接口传当前 session；无状态 completion 传 null。 */
    sessionId: string | null;
    attachmentIds: string[];
  }) => Promise<ResolvedAiImageAttachment[]>;
}

export function createAiAttachmentResolver(deps: {
  repository: AiAttachmentRepository;
  storage: StorageDriver;
}): AiAttachmentResolver {
  function attachmentNotFound(): AppError {
    return new AppError(
      ApiErrorCodes.AI_ATTACHMENT_NOT_FOUND,
      "附件不存在",
      404,
    );
  }

  async function resolveForRequest(input: {
    access: RuntimeAccessContext;
    sessionId: string | null;
    attachmentIds: string[];
  }): Promise<ResolvedAiImageAttachment[]> {
    const { access, sessionId, attachmentIds } = input;
    if (attachmentIds.length === 0) return [];
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_REQUEST) {
      throw new AppError(
        ApiErrorCodes.AI_ATTACHMENT_COUNT_EXCEEDED,
        "单次请求最多携带 4 张图片",
        400,
      );
    }

    const records = deps.repository.findByIds(attachmentIds);
    const byId = new Map(records.map((record) => [record.id, record]));

    const resolved: ResolvedAiImageAttachment[] = [];
    for (const attachmentId of attachmentIds) {
      const record = byId.get(attachmentId);
      if (!record || !isAiAttachmentOwnedBy(record, access)) {
        throw attachmentNotFound();
      }
      // 挂了 session 的附件只能在同一 session 的请求里引用。
      if (record.sessionId !== null && record.sessionId !== sessionId) {
        throw attachmentNotFound();
      }
      let bytes: Uint8Array;
      try {
        bytes = await deps.storage.read(record.storagePath);
      } catch {
        throw attachmentNotFound();
      }
      resolved.push({
        attachmentId: record.id,
        mimeType: aiAttachmentMimeTypeSchema.parse(record.mimeType),
        data: Buffer.from(bytes).toString("base64"),
      });
    }
    return resolved;
  }

  return { resolveForRequest };
}
