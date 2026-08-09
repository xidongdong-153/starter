import type { CurrentPermissions } from '@starter/contracts'
import type { ReactNode } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'

/** 权限接口返回体，四个测试文件共用同一份形状，避免 DTO 变动时漏改 */
export function createCurrentPermissions(permissions: CurrentPermissions['permissions']): CurrentPermissions {
  return { roles: ['operator'], permissions, version: 'test-version' }
}

/** 关掉重试，否则 error 用例要等默认重试耗尽 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

export function renderWithQueryClient(ui: ReactNode, queryClient: QueryClient) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

export function createQueryClientWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}
