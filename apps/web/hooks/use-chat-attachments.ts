'use client'

import { useCallback, useRef, useState } from 'react'

import { attachmentContentUrl, uploadAiAttachment } from '@web/lib/api/ai-attachments.api'
import { describeError } from '@web/lib/ai/chat-run-view'
import { attachmentRejectionMessage, selectUploadableImages } from '@web/lib/ai/attachment-input'

/** 待发送区里的一个附件；uploading 阶段还没有 attachmentId。 */
export interface ChatAttachmentItem {
  /** React 列表 key；上传完成前后不变。 */
  key: string
  name: string
  status: 'ready' | 'uploading'
  attachmentId: string | null
  /** 缩略图地址，指向附件下载端点；uploading 阶段为 null。 */
  url: string | null
}

/**
 * Chat 待发送图片附件的状态与上传编排。
 *
 * 文件先过本地预校验（MIME 白名单、5MB、最多 4 张），通过的立即上传
 * （带当前 sessionId；新对话还没有 session 时按 principal 归属上传），
 * 上传期间显示占位，失败则移除占位并提示。上传失败的附件不会留在待发送区。
 */
export function useChatAttachments(sessionId: string | null) {
  const [items, setItems] = useState<ChatAttachmentItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const keySeqRef = useRef(0)

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return

      const { accepted, rejections } = selectUploadableImages(files, items.length)
      setError(rejections.length > 0 ? attachmentRejectionMessage(rejections[0]!.rejection) : null)
      if (accepted.length === 0) return

      const placeholders: ChatAttachmentItem[] = accepted.map((file) => ({
        key: `local-${++keySeqRef.current}`,
        name: file.name,
        status: 'uploading',
        attachmentId: null,
        url: null,
      }))
      setItems((current) => [...current, ...placeholders])

      void Promise.all(
        accepted.map(async (file, index) => {
          const placeholder = placeholders[index]!
          try {
            const uploaded = await uploadAiAttachment(file, sessionId ?? undefined)
            setItems((current) =>
              current.map((item) =>
                item.key === placeholder.key
                  ? {
                      ...item,
                      status: 'ready',
                      attachmentId: uploaded.id,
                      url: attachmentContentUrl(uploaded.id),
                    }
                  : item,
              ),
            )
          } catch (uploadError) {
            // 上传失败只移除这一个附件，不影响其他文件的结果。
            setItems((current) => current.filter((item) => item.key !== placeholder.key))
            setError(describeError(uploadError))
          }
        }),
      )
    },
    [items.length, sessionId],
  )

  const remove = useCallback((key: string) => {
    setItems((current) => current.filter((item) => item.key !== key))
    setError(null)
  }, [])

  const clear = useCallback(() => {
    setItems([])
    setError(null)
  }, [])

  /** 发送失败时把附件放回待发送区，重试不用重新上传。 */
  const restore = useCallback((restored: ChatAttachmentItem[]) => {
    setItems(restored)
    setError(null)
  }, [])

  return { items, error, addFiles, remove, clear, restore }
}
