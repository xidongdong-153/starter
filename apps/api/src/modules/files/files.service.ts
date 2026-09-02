import type { StorageDriver } from '@api/infra/storage/index.js'
import type { FilesRepository } from './files.repository.js'
import type { FileItem } from '@starter/contracts'
import { ApiErrorCodes } from '@starter/contracts'
import { AppError } from '@api/shared/app-error.js'
import { toFileItem } from './files.presenter.js'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

export function createFilesService(storage: StorageDriver, repository: FilesRepository) {
  async function list(ownerId: string): Promise<FileItem[]> {
    return (await repository.listByOwner(ownerId)).map(toFileItem)
  }

  async function upload(ownerId: string, file: File): Promise<FileItem> {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new AppError(ApiErrorCodes.COMMON_PAYLOAD_TOO_LARGE, '文件不能超过 10 MiB', 413)
    }

    const stored = await storage.write(ownerId, file.name, new Uint8Array(await file.arrayBuffer()))
    const now = new Date()

    try {
      const record = await repository.create({
        id: stored.fileId,
        ownerId,
        name: file.name,
        storagePath: stored.relative,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        createdAt: now,
        updatedAt: now,
      })
      return toFileItem(record)
    } catch (error) {
      await storage.remove(stored.relative).catch(() => undefined)
      throw error
    }
  }

  async function open(fileId: string, ownerId: string): Promise<Response> {
    const file = await findOwned(fileId, ownerId)
    try {
      const data = await storage.read(file.storagePath)
      return new Response(data, {
        headers: {
          'Content-Type': file.mimeType,
          'Content-Length': String(file.size),
          'Content-Disposition': `inline; filename="${encodeURIComponent(file.name)}"`,
        },
      })
    } catch {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, '文件不存在', 404)
    }
  }

  async function rename(fileId: string, ownerId: string, name: string): Promise<FileItem> {
    const file = await repository.rename(fileId, ownerId, name)
    if (!file) {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, '文件不存在', 404)
    }
    return toFileItem(file)
  }

  async function remove(fileId: string, ownerId: string): Promise<{ ok: true }> {
    const file = repository.deleteOwned(fileId, ownerId)
    if (!file) {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, '文件不存在', 404)
    }
    await storage.remove(file.storagePath)
    return { ok: true }
  }

  async function findOwned(fileId: string, ownerId: string) {
    const file = await repository.findOwned(fileId, ownerId)
    if (!file) {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, '文件不存在', 404)
    }
    return file
  }

  return { findOwned, list, open, remove, rename, upload }
}

export type FilesService = ReturnType<typeof createFilesService>
