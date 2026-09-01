import type { AiAttachment } from '@starter/contracts'
import { aiAttachmentSchema } from '@starter/contracts'
import { resolveApiUrl } from '@web/lib/env.client'
import { apiRequest } from '@web/lib/http'

/**
 * 上传 AI 图片附件，走 Chat 产品面 `/api/chat/attachments`。
 *
 * multipart 字段 `file` + 可选 `sessionId`；附件挂在当前登录 principal 下，
 * 携带 sessionId 时额外校验 session 归属。4xx（超限、白名单外、越权 session）
 * 抛带 error code 的 `ApiRequestError`。
 */
export async function uploadAiAttachment(file: File, sessionId?: string): Promise<AiAttachment> {
  const form = new FormData()
  form.append('file', file)
  if (sessionId !== undefined) form.append('sessionId', sessionId)

  const data = await apiRequest('/api/chat/attachments', { method: 'POST', body: form })
  const parsed = aiAttachmentSchema.safeParse(data)
  if (!parsed.success) throw new Error('附件上传返回的数据格式不正确。')
  return parsed.data
}

/**
 * 附件图片的下载地址。`<img>` 直接引用：API 与 Web 同站（端口不同），
 * cookie 会随图片请求自动携带，与头像图片的加载方式一致。
 */
export function attachmentContentUrl(attachmentId: string): string {
  return resolveApiUrl(`/api/chat/attachments/${attachmentId}/content`)
}
