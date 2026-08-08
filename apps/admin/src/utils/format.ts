/**
 * 把字节数写成可读大小
 */
export function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KiB`
  }

  return `${(size / 1024 / 1024).toFixed(1)} MiB`
}
