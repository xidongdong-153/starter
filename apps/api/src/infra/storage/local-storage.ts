import { mkdir } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { generateId } from '@api/shared/id.js'
import type { StorageDriver } from './storage.types.js'

export class LocalStorage implements StorageDriver {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async init() {
    await mkdir(this.root, { recursive: true })
  }

  pathFor(ownerId: string, fileId: string, originalName: string) {
    const extension = extname(originalName)
      .slice(0, 16)
      .replace(/[^a-zA-Z0-9.]/g, '')
    const relative = `${ownerId}/${fileId}${extension}`
    const target = resolve(this.root, relative)
    if (target !== this.root && !target.startsWith(`${this.root}${sep}`)) throw new Error('存储路径无效')
    return { relative, target }
  }

  async write(ownerId: string, originalName: string, data: Uint8Array) {
    const fileId = generateId()
    const path = this.pathFor(ownerId, fileId, originalName)
    await mkdir(dirname(path.target), { recursive: true })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path.target, data, { flag: 'wx' })
    return { fileId, relative: path.relative }
  }

  async read(relative: string) {
    const target = resolve(this.root, relative)
    if (!target.startsWith(`${this.root}${sep}`)) throw new Error('存储路径无效')
    const { readFile } = await import('node:fs/promises')
    return readFile(target)
  }

  async remove(relative: string) {
    const target = resolve(this.root, relative)
    if (!target.startsWith(`${this.root}${sep}`)) throw new Error('存储路径无效')
    const { rm } = await import('node:fs/promises')
    await rm(target, { force: true })
  }
}
