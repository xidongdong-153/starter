import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { profileQueryKeys } from '../profile'
import { deleteFile, getFiles, renameFile, uploadFile } from './files.api'

export const filesQueryKeys = {
  all: ['files'] as const,
  list: () => [...filesQueryKeys.all, 'list'] as const,
}

export function useFilesQuery() {
  return useQuery({
    queryKey: filesQueryKeys.list(),
    queryFn: getFiles,
  })
}

export function useUploadFileMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (file: File) => uploadFile(file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: filesQueryKeys.list() })
    },
  })
}

export function useRenameFileMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: renameFile,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: filesQueryKeys.list() })
    },
  })
}

export function useDeleteFileMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (fileId: string) => deleteFile(fileId),
    onSuccess: async () => {
      // 删除文件会同时清掉引用它的头像
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: filesQueryKeys.list() }),
        queryClient.invalidateQueries({ queryKey: profileQueryKeys.detail() }),
      ])
    },
  })
}
