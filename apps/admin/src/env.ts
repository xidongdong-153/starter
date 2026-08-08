import type { AdminEnv } from './env.schema'
import { parseAdminEnv } from './env.schema'

export type { AdminEnv } from './env.schema'

export function getAdminEnv(): AdminEnv {
  return parseAdminEnv({
    VITE_API_URL: import.meta.env.VITE_API_URL,
    VITE_APP_ENV: import.meta.env.VITE_APP_ENV,
  })
}
