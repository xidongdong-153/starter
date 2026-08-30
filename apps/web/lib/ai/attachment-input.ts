import { aiAttachmentMimeTypeSchema } from '@starter/contracts'

/** 图片附件的 MIME 白名单，来源 contracts 的 aiAttachmentMimeTypeSchema，前后端共用一份。 */
export const ATTACHMENT_MIME_TYPES: readonly string[] = aiAttachmentMimeTypeSchema.options
/** 文件选择器的 accept 值。 */
export const ATTACHMENT_ACCEPT = ATTACHMENT_MIME_TYPES.join(',')
/** 单张图片上限 5MB，与服务端 attachment service 的校验一致。 */
export const ATTACHMENT_MAX_SIZE_BYTES = 5 * 1024 * 1024
/** 一次发送最多携带 4 张图片，与服务端 attachmentIds 的 max(4) 一致。 */
export const ATTACHMENT_MAX_COUNT = 4

export type AttachmentRejection = 'count_exceeded' | 'too_large' | 'type_not_allowed'

export interface AttachmentRejectionItem {
  name: string
  rejection: AttachmentRejection
}

export interface ImageSelection {
  accepted: File[]
  rejections: AttachmentRejectionItem[]
}

const MIME_WHITELIST = new Set<string>(ATTACHMENT_MIME_TYPES)

/**
 * 从用户选择 / 粘贴 / 拖入的文件里筛出可上传的图片。
 *
 * 逐个校验 MIME 白名单与 5MB 上限，再受「待发送区最多 4 张」约束：
 * 超出配额的文件按 count_exceeded 拒绝，不影响前面的文件。被拒文件带原因返回，
 * 调用方据此提示，不发起上传请求。
 */
export function selectUploadableImages(files: Iterable<File>, currentCount: number): ImageSelection {
  const accepted: File[] = []
  const rejections: AttachmentRejectionItem[] = []
  let count = currentCount

  for (const file of files) {
    if (!MIME_WHITELIST.has(file.type)) {
      rejections.push({ name: file.name, rejection: 'type_not_allowed' })
      continue
    }
    if (file.size > ATTACHMENT_MAX_SIZE_BYTES) {
      rejections.push({ name: file.name, rejection: 'too_large' })
      continue
    }
    if (count >= ATTACHMENT_MAX_COUNT) {
      rejections.push({ name: file.name, rejection: 'count_exceeded' })
      continue
    }
    count += 1
    accepted.push(file)
  }

  return { accepted, rejections }
}

/** 预校验拒绝原因对应的提示文案。 */
export function attachmentRejectionMessage(rejection: AttachmentRejection): string {
  const maxSizeMb = ATTACHMENT_MAX_SIZE_BYTES / (1024 * 1024)
  switch (rejection) {
    case 'type_not_allowed':
      return '仅支持 JPEG、PNG、WebP、GIF 格式的图片。'
    case 'too_large':
      return `单张图片不能超过 ${maxSizeMb}MB。`
    case 'count_exceeded':
      return `一次最多携带 ${ATTACHMENT_MAX_COUNT} 张图片。`
  }
}
