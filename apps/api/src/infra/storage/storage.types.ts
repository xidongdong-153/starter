export interface StoredFile {
  fileId: string
  relative: string
}

export interface StorageDriver {
  init: () => Promise<void>
  read: (relativePath: string) => Promise<Uint8Array>
  remove: (relativePath: string) => Promise<void>
  write: (ownerId: string, originalName: string, data: Uint8Array) => Promise<StoredFile>
}
