import type { FileItem } from '@starter/contracts'

import { apiRequest, fetchApi } from '@admin/api/http'

/**
 * 读取当前账号的文件列表
 */
export function getFiles() {
  return apiRequest<FileItem[]>('/api/files')
}

/**
 * 上传文件，单个最大 10 MiB
 */
export function uploadFile(file: File) {
  const form = new FormData()
  form.set('file', file)

  return apiRequest<FileItem>('/api/files', {
    method: 'POST',
    body: form,
  })
}

/**
 * 重命名文件
 */
export function renameFile(input: { fileId: string; name: string }) {
  return apiRequest<FileItem>(`/api/files/${input.fileId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: input.name }),
  })
}

/**
 * 删除文件
 */
export function deleteFile(fileId: string) {
  return apiRequest<{ ok: boolean }>(`/api/files/${fileId}`, {
    method: 'DELETE',
  })
}

/**
 * 读取文件内容，用于下载
 */
export function downloadFileBlob(file: FileItem) {
  return fetchApi(file.contentUrl).then(async (response) => {
    if (!response.ok) {
      throw new Error('文件下载失败，稍后再试')
    }

    return response.blob()
  })
}
