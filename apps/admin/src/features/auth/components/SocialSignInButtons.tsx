import type { SocialProvider } from '@admin/api/auth'

import { useAuthConfigQuery, useSignInSocialMutation } from '@admin/api/auth'
import { Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { SiGithub, SiGoogle } from 'react-icons/si'

interface SocialSignInButtonsProps {
  onError: (message: string) => void
}

/**
 * 第三方登录按钮。后端没配置对应 provider 时不显示。
 */
export function SocialSignInButtons({ onError }: SocialSignInButtonsProps) {
  const { t } = useTranslation()
  const authConfigQuery = useAuthConfigQuery()
  const signInSocialMutation = useSignInSocialMutation()
  const providers = authConfigQuery.data?.providers

  if (!providers?.github && !providers?.google) {
    return null
  }

  const handleSignIn = async (provider: SocialProvider) => {
    try {
      await signInSocialMutation.mutateAsync({
        callbackURL: window.location.origin,
        provider,
      })
    } catch (error) {
      onError(error instanceof Error ? error.message : t('auth.socialFailed'))
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      {providers.github ? (
        <Button
          icon={<SiGithub className="size-4" />}
          loading={signInSocialMutation.isPending}
          onClick={() => void handleSignIn('github')}
          className="h-10 w-full rounded-lg"
        >
          {t('auth.socialGithub')}
        </Button>
      ) : null}

      {providers.google ? (
        <Button
          icon={<SiGoogle className="size-4" />}
          loading={signInSocialMutation.isPending}
          onClick={() => void handleSignIn('google')}
          className="h-10 w-full rounded-lg"
        >
          {t('auth.socialGoogle')}
        </Button>
      ) : null}
    </div>
  )
}
