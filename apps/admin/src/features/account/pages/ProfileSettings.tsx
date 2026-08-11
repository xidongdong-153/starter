import type { SocialProvider } from '@admin/api/auth'
import type { AccountProfile, UpdateProfileInput } from '@starter/contracts'

import { PermissionKeys } from '@starter/contracts'

import { resolveApiUrl } from '@admin/api/client'
import { useAuthConfigQuery, useLinkSocialMutation } from '@admin/api/auth'
import { useFilesQuery } from '@admin/api/files'
import {
  useClearProfileAvatarMutation,
  useProfileQuery,
  useSetProfileAvatarMutation,
  useUpdateProfileMutation,
} from '@admin/api/profile'
import { AdminPageHeader, PermissionGuard } from '@admin/components/common'
import { usePermission } from '@admin/hooks/usePermission'
import { formatDate } from '@admin/utils/dayjs'
import { Alert, App, Button, Form, Input, Spin, Switch, Tag } from 'antd'
import { Eraser, KeyRound, Save, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { SiGithub, SiGoogle } from 'react-icons/si'

interface ProfileFormValues {
  availableForWork: boolean
  bio: string
  contactEmail: string
  location: string
  name: string
  socialLinksText: string
}

function toFormValues(profile: AccountProfile): ProfileFormValues {
  return {
    availableForWork: profile.availableForWork,
    bio: profile.bio ?? '',
    contactEmail: profile.contactEmail ?? '',
    location: profile.location ?? '',
    name: profile.name,
    socialLinksText: profile.socialLinks.join('\n'),
  }
}

function toUpdateInput(values: ProfileFormValues): UpdateProfileInput {
  return {
    availableForWork: values.availableForWork,
    bio: values.bio.trim() || null,
    contactEmail: values.contactEmail.trim() || null,
    location: values.location.trim() || null,
    name: values.name.trim(),
    socialLinks: values.socialLinksText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
  }
}

function getProviderIcon(provider: string) {
  if (provider === 'github') {
    return <SiGithub className="size-4" />
  }

  if (provider === 'google') {
    return <SiGoogle className="size-4 text-[#4285f4]" />
  }

  return <KeyRound className="size-4" />
}

function getProviderTagClasses(provider: string): string {
  switch (provider) {
    case 'github':
      return 'bg-[#0d1117] text-white'
    case 'google':
      return 'bg-white text-[#757575] border border-[#dadce0]'
    default:
      return 'bg-surface-muted text-fg-muted border border-border-subtle'
  }
}

function getProviderLabelKey(provider: string) {
  if (provider === 'github' || provider === 'google' || provider === 'credential') {
    return `profile.provider.${provider}`
  }

  return provider
}

function getSocialLinkErrorKey(error: string) {
  switch (error) {
    case 'account_already_linked_to_different_user':
      return 'profile.accountLinkErrors.alreadyUsed'
    case "email_doesn't_match":
    case 'LINKING_DIFFERENT_EMAILS_NOT_ALLOWED':
      return 'profile.accountLinkErrors.emailMismatch'
    case 'LINKING_NOT_ALLOWED':
    case 'email_not_found':
    case 'user_email_not_found':
      return 'profile.accountLinkErrors.emailUnavailable'
    case 'access_denied':
      return 'profile.accountLinkErrors.cancelled'
    default:
      return 'profile.accountLinkErrors.failed'
  }
}

interface AvatarPreviewProps {
  avatarUrl: string | null
  displayName?: string
}

function AvatarPreview({ avatarUrl, displayName }: AvatarPreviewProps) {
  return (
    <div className="border-border-subtle bg-primary text-primary-foreground grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border text-2xl font-semibold shadow-sm">
      {avatarUrl ? (
        <img src={resolveApiUrl(avatarUrl)} alt="" className="block size-full object-cover" />
      ) : (
        <span>
          {displayName?.trim() ? displayName.trim().slice(0, 1).toUpperCase() : <UserRound className="size-8" />}
        </span>
      )}
    </div>
  )
}

export function ProfileSettings() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm<ProfileFormValues>()
  const fileListPermission = usePermission(PermissionKeys.FILE_LIST)
  const fileReadPermission = usePermission(PermissionKeys.FILE_READ)
  const authConfigQuery = useAuthConfigQuery()
  const profileQuery = useProfileQuery()
  const linkSocialMutation = useLinkSocialMutation()
  const filesQuery = useFilesQuery({ enabled: fileListPermission.allowed && fileReadPermission.allowed })
  const updateProfileMutation = useUpdateProfileMutation()
  const setAvatarMutation = useSetProfileAvatarMutation()
  const clearAvatarMutation = useClearProfileAvatarMutation()

  const [socialLinkErrorKey, setSocialLinkErrorKey] = useState<string | null>(null)
  const profile = profileQuery.data
  const imageFiles = (filesQuery.data ?? []).filter((file) => file.mimeType.startsWith('image/'))

  const enabledSocialProviders: SocialProvider[] = []
  if (authConfigQuery.data?.providers.github) enabledSocialProviders.push('github')
  if (authConfigQuery.data?.providers.google) enabledSocialProviders.push('google')

  useEffect(() => {
    if (profile) {
      form.setFieldsValue(toFormValues(profile))
    }
  }, [form, profile])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('error')
    if (!error) return

    setSocialLinkErrorKey(getSocialLinkErrorKey(error))
    params.delete('error')
    params.delete('error_description')
    const query = params.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    )
  }, [])

  const handleLinkSocial = async (provider: SocialProvider) => {
    setSocialLinkErrorKey(null)

    const callbackURL = `${window.location.origin}/settings/profile`
    try {
      await linkSocialMutation.mutateAsync({ callbackURL, errorCallbackURL: callbackURL, provider })
    } catch {
      setSocialLinkErrorKey('profile.accountLinkErrors.failed')
    }
  }

  const handleSave = async (values: ProfileFormValues) => {
    try {
      await updateProfileMutation.mutateAsync(toUpdateInput(values))
      message.success(t('profile.saveSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('profile.saveFailed'))
    }
  }

  const handleSelectAvatar = async (fileId: string) => {
    try {
      await setAvatarMutation.mutateAsync(fileId)
      message.success(t('profile.avatarUpdated'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('profile.saveFailed'))
    }
  }

  const handleClearAvatar = async () => {
    try {
      await clearAvatarMutation.mutateAsync()
      message.success(t('profile.avatarCleared'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('profile.saveFailed'))
    }
  }

  if (profileQuery.isLoading) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Spin />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t('profile.title')}
        description={t('profile.description')}
        summaryItems={[
          { label: t('profile.summary.providers'), value: profile?.providers.length ?? 0 },
          { label: t('profile.summary.updatedAt'), value: profile ? formatDate(profile.updatedAt) : '-' },
        ]}
      />

      {authConfigQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={t('profile.accountLinkConfigFailed')}
          description={authConfigQuery.error instanceof Error ? authConfigQuery.error.message : undefined}
          action={<Button onClick={() => void authConfigQuery.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}

      {profileQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={t('profile.loadFailed')}
          description={profileQuery.error instanceof Error ? profileQuery.error.message : undefined}
          action={<Button onClick={() => void profileQuery.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}

      {socialLinkErrorKey ? <Alert showIcon type="error" message={t(socialLinkErrorKey)} /> : null}

      {profile ? (
        <>
          <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
            <section className="border-border-subtle bg-surface overflow-hidden rounded-lg border">
              <div className="border-border-subtle border-b px-5 py-4">
                <div className="text-fg text-sm font-medium">{t('profile.avatarTitle')}</div>
                <p className="text-fg-muted mt-1 text-sm">{t('profile.avatarDescription')}</p>
              </div>

              <div className="space-y-5 p-5">
                <div className="flex items-center gap-4">
                  <AvatarPreview avatarUrl={profile.avatarUrl} displayName={profile.name} />
                  <div className="min-w-0 flex-1">
                    <div className="text-fg truncate text-sm font-medium">{profile.name}</div>
                    <div className="text-fg-muted mt-1 truncate text-xs">{profile.email}</div>
                  </div>
                </div>

                <PermissionGuard permission={PermissionKeys.FILE_LIST}>
                  <PermissionGuard permission={PermissionKeys.FILE_READ}>
                    {filesQuery.isLoading ? (
                      <div className="flex min-h-24 items-center justify-center">
                        <Spin size="small" />
                      </div>
                    ) : filesQuery.error ? (
                      <Alert
                        showIcon
                        type="error"
                        message={t('profile.filesLoadFailed')}
                        action={<Button onClick={() => void filesQuery.refetch()}>{t('common.retry')}</Button>}
                      />
                    ) : imageFiles.length > 0 ? (
                      <div className="grid grid-cols-3 gap-2">
                        {imageFiles.map((file) => (
                          <button
                            type="button"
                            key={file.id}
                            title={`${t('profile.selectAvatar')}: ${file.name}`}
                            disabled={setAvatarMutation.isPending}
                            onClick={() => void handleSelectAvatar(file.id)}
                            className="border-border-subtle hover:border-primary focus-visible:border-primary aspect-square cursor-pointer overflow-hidden rounded-lg border transition-colors focus-visible:outline-none"
                          >
                            <img
                              src={resolveApiUrl(file.contentUrl)}
                              alt=""
                              crossOrigin="use-credentials"
                              className="block size-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="border-border-subtle bg-surface-muted/50 rounded-lg border px-4 py-3">
                        <p className="text-fg-muted text-sm">{t('profile.avatarEmpty')}</p>
                        <Link to={'/files' as never} className="text-primary mt-2 inline-block text-sm">
                          {t('profile.goFiles')}
                        </Link>
                      </div>
                    )}
                  </PermissionGuard>
                </PermissionGuard>

                <Button
                  icon={<Eraser className="size-4" />}
                  disabled={!profile.avatarUrl}
                  loading={clearAvatarMutation.isPending}
                  onClick={() => void handleClearAvatar()}
                  block
                >
                  {t('profile.clearAvatar')}
                </Button>
              </div>
            </section>

            <section className="border-border-subtle bg-surface overflow-hidden rounded-lg border">
              <div className="border-border-subtle border-b px-5 py-4">
                <div className="text-fg text-sm font-medium">{t('profile.basicTitle')}</div>
                <p className="text-fg-muted mt-1 text-sm">{t('profile.basicDescription')}</p>
              </div>

              <div className="p-5">
                <Form form={form} layout="vertical" onFinish={handleSave}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Form.Item
                      name="name"
                      label={t('profile.displayName')}
                      rules={[{ message: t('profile.displayNameRequired'), required: true }]}
                    >
                      <Input placeholder={t('profile.displayNamePlaceholder')} />
                    </Form.Item>
                    <Form.Item
                      name="contactEmail"
                      label={t('profile.contactEmail')}
                      rules={[{ message: t('profile.contactEmailInvalid'), type: 'email' }]}
                    >
                      <Input placeholder={t('profile.contactEmailPlaceholder')} />
                    </Form.Item>
                  </div>

                  <Form.Item name="bio" label={t('profile.bio')}>
                    <Input.TextArea rows={3} placeholder={t('profile.bioPlaceholder')} />
                  </Form.Item>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Form.Item name="location" label={t('profile.location')}>
                      <Input placeholder={t('profile.locationPlaceholder')} />
                    </Form.Item>
                    <Form.Item name="availableForWork" label={t('profile.availableForWork')} valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </div>

                  <Form.Item name="socialLinksText" label={t('profile.socialLinks')}>
                    <Input.TextArea rows={3} placeholder={t('profile.socialLinksPlaceholder')} />
                  </Form.Item>

                  <Button
                    type="primary"
                    htmlType="submit"
                    icon={<Save className="size-4" />}
                    loading={updateProfileMutation.isPending}
                  >
                    {t('profile.save')}
                  </Button>
                </Form>
              </div>
            </section>
          </div>

          <section className="border-border-subtle bg-surface rounded-lg border">
            <div className="border-border-subtle border-b px-5 py-4">
              <div className="text-fg text-sm font-medium">{t('profile.accountsTitle')}</div>
              <p className="text-fg-muted mt-1 text-sm">{t('profile.accountsDescription')}</p>
            </div>
            <div className="divide-border-subtle divide-y">
              <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-fg-muted text-sm">{t('profile.userId')}</div>
                <div className="text-fg text-sm break-all">{profile.userId}</div>
              </div>
              <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-fg-muted text-sm">{t('profile.email')}</div>
                <div className="text-fg text-sm break-all">{profile.email}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 px-5 py-4">
                {profile.providers.map((provider) => (
                  <span
                    key={provider}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${getProviderTagClasses(provider)}`}
                  >
                    {getProviderIcon(provider)}
                    {t(getProviderLabelKey(provider))}
                  </span>
                ))}
              </div>
              {enabledSocialProviders.length > 0 ? (
                <div className="border-border-subtle space-y-3 border-t px-5 py-4">
                  <div className="text-fg text-sm font-medium">{t('profile.accountLinkTitle')}</div>
                  {enabledSocialProviders.map((provider) => {
                    const bound = profile.providers.includes(provider)
                    return (
                      <div
                        key={provider}
                        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-center gap-2 text-sm">
                          {getProviderIcon(provider)}
                          <span>{t(getProviderLabelKey(provider))}</span>
                        </div>
                        {bound ? (
                          <Tag color="success" className="m-0 w-fit">
                            {t('profile.accountLinkBound')}
                          </Tag>
                        ) : (
                          <Button
                            icon={getProviderIcon(provider)}
                            loading={linkSocialMutation.isPending}
                            onClick={() => void handleLinkSocial(provider)}
                          >
                            {t('profile.accountLinkAction')}
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
