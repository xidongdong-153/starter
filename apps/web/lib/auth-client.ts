'use client'

import { createAuthClient } from 'better-auth/react'
import { apiUrl } from './env.client'

export const authClient = createAuthClient({
  baseURL: apiUrl,
  fetchOptions: { credentials: 'include' },
})

export { apiUrl }
