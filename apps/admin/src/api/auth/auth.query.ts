import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getAuthConfig } from './auth-config.api'
import { getAdminSession } from './session.api'
import { linkSocial } from './link-social.api'
import { signInEmail, signInSocial } from './sign-in.api'
import { signOut } from './sign-out.api'
import { signUpEmail } from './sign-up.api'

export const authQueryKeys = {
  all: ['auth'] as const,
  config: () => [...authQueryKeys.all, 'config'] as const,
  session: () => [...authQueryKeys.all, 'session'] as const,
}

export function useAuthConfigQuery() {
  return useQuery({
    queryKey: authQueryKeys.config(),
    queryFn: getAuthConfig,
    staleTime: 5 * 60_000,
  })
}

export function useAdminSessionQuery() {
  return useQuery({
    queryKey: authQueryKeys.session(),
    queryFn: getAdminSession,
  })
}

export function useSignInEmailMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: signInEmail,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.session() })
    },
  })
}

export function useSignInSocialMutation() {
  return useMutation({
    mutationFn: signInSocial,
  })
}

export function useLinkSocialMutation() {
  return useMutation({
    mutationFn: linkSocial,
  })
}

export function useSignUpEmailMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: signUpEmail,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.session() })
    },
  })
}

export function useSignOutMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear()
    },
  })
}
