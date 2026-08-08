import type { UpdateProfileInput } from '@starter/contracts'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { clearProfileAvatar, getProfile, setProfileAvatar, updateProfile } from './profile.api'

export const profileQueryKeys = {
  all: ['profile'] as const,
  detail: () => [...profileQueryKeys.all, 'detail'] as const,
}

export function useProfileQuery() {
  return useQuery({
    queryKey: profileQueryKeys.detail(),
    queryFn: getProfile,
  })
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateProfileInput) => updateProfile(input),
    onSuccess: (profile) => {
      queryClient.setQueryData(profileQueryKeys.detail(), profile)
    },
  })
}

export function useSetProfileAvatarMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (fileId: string) => setProfileAvatar(fileId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileQueryKeys.detail() })
    },
  })
}

export function useClearProfileAvatarMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: clearProfileAvatar,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileQueryKeys.detail() })
    },
  })
}
