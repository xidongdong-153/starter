import type { MenuProps } from 'antd'

import { useSignOutMutation } from '@admin/api/auth'
import { useProfileQuery } from '@admin/api/profile'
import { resolveApiUrl } from '@admin/api/client'
import { useNavigate } from '@tanstack/react-router'
import { App, Avatar, Dropdown } from 'antd'
import { LogOut, UserRound } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

function getAvatarInitial(displayName?: string) {
  const trimmedName = displayName?.trim()

  if (!trimmedName) {
    return 'A'
  }

  return trimmedName.slice(0, 1).toUpperCase()
}

/**
 * 顶栏账号菜单，放个人资料入口和退出登录
 */
export function AccountMenuButton() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const profileQuery = useProfileQuery()
  const signOutMutation = useSignOutMutation()
  const profile = profileQuery.data
  const displayName = profile?.name ?? t('auth.currentAccount')

  const menuItems = useMemo<MenuProps['items']>(
    () => [
      {
        key: 'account',
        disabled: true,
        label: (
          <div className="min-w-36 px-1 py-0.5">
            <div className="text-fg text-sm font-medium">{displayName}</div>
            <div className="text-fg-muted mt-0.5 text-xs">{profile?.email ?? t('auth.currentAccount')}</div>
          </div>
        ),
      },
      {
        type: 'divider',
      },
      {
        key: 'profile',
        icon: <UserRound size={14} />,
        label: t('auth.profile'),
      },
      {
        key: 'sign-out',
        danger: true,
        icon: <LogOut size={14} />,
        label: t('auth.signOut'),
      },
    ],
    [displayName, profile?.email, t],
  )

  const handleMenuClick: MenuProps['onClick'] = async ({ key }) => {
    if (key === 'profile') {
      await navigate({ to: '/settings/profile' as never })
      return
    }

    if (key !== 'sign-out') {
      return
    }

    try {
      await signOutMutation.mutateAsync()
      message.success(t('auth.signOutSuccess'))
      await navigate({ replace: true, to: '/login' as never })
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('auth.signOutFailed'))
    }
  }

  return (
    <Dropdown
      trigger={['click']}
      placement="bottomRight"
      menu={{
        items: menuItems,
        onClick: handleMenuClick,
      }}
    >
      <button
        type="button"
        aria-label={t('auth.accountMenu')}
        className="hover:border-primary/60 focus-visible:border-primary focus-visible:ring-primary/20 border-border-subtle bg-surface-muted flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <Avatar
          size={30}
          src={profile?.avatarUrl ? resolveApiUrl(profile.avatarUrl) : undefined}
          className="bg-primary text-primary-foreground text-sm font-semibold"
        >
          {getAvatarInitial(profile?.name)}
        </Avatar>
      </button>
    </Dropdown>
  )
}
