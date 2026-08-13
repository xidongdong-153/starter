import type { FileItem } from '@starter/contracts'
import type { InferResponseType } from 'hono/client'

import { apiRpc, unwrapApiData } from '@admin/api/rpc'
import { apiRequest, fetchApi } from '@admin/api/http'

type RenameFileData = InferResponseType<(typeof apiRpc.api.files)[':fileId']['$patch'], 200>['data']
type DeleteFileData = InferResponseType<(typeof apiRpc.api.files)[':fileId']['$delete'], 200>['data']

/**
 * 读取当前账号的文件列表
 */
export function getFiles(): Promise<FileItem[]> {
  return unwrapApiData(apiRpc.api.files.$get())
}

/**
 * 上传文件，单个最大 10 MiB。
 * multipart/form-data 保留专用函数，不设置 Content-Type，由浏览器生成 boundary。
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
export function renameFile(input: { fileId: string; name: string }): Promise<RenameFileData> {
  return unwrapApiData(
    apiRpc.api.files[':fileId'].$patch({
      param: { fileId: encodeURIComponent(input.fileId) },
      json: { name: input.name },
    }),
  )
}

/**
 * 删除文件
 */
export function deleteFile(fileId: string): Promise<DeleteFileData> {
  return unwrapApiData(
    apiRpc.api.files[':fileId'].$delete({
      param: { fileId: encodeURIComponent(fileId) },
    }),
  )
}

/**
 * 读取文件内容，用于下载，保留原始 Response
 */
export function downloadFileBlob(file: FileItem) {
  return fetchApi(file.contentUrl).then(async (response) => {
    if (!response.ok) {
      throw new Error('文件下载失败，稍后再试')
    }

    return response.blob()
  })
}
