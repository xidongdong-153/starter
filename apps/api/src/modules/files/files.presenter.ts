import type { FileItem } from '@starter/contracts'
import type { FileRecord } from './files.repository.js'

export function toFileItem(file: FileRecord): FileItem {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    contentUrl: `/api/files/${file.id}/content`,
  } satisfies FileItem
}
