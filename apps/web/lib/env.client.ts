const DEFAULT_API_URL = 'http://localhost:7788'

export const apiUrl = (process.env.NEXT_PUBLIC_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, '')

export function resolveApiUrl(path: string): string {
  return new URL(path, `${apiUrl}/`).toString()
}
