import type { AccountProfile, UpdateProfileInput } from '@starter/contracts'

import { resolveApiUrl } from '@admin/api/client'
import { useFilesQuery } from '@admin/api/files'
import {
  useClearProfileAvatarMutation,
  useProfileQuery,
  useSetProfileAvatarMutation,
  useUpdateProfileMutation,
} from '@admin/api/profile'
import { AdminPageHeader } from '@admin/components/common'
import { formatDate } from '@admin/utils/dayjs'
import { Alert, App, Button, Form, Input, Spin, Switch, Tag } from 'antd'
import { Eraser, KeyRound, Save, UserRound } from 'lucide-react'
import { useEffect } from 'react'
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
    return <SiGoogle className="size-4" />
  }

  return <KeyRound className="size-4" />
}

function getProviderLabelKey(provider: string) {
  if (provider === 'github' || provider === 'google' || provider === 'credential') {
    return `profile.provider.${provider}`
  }

  return provider
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
  const profileQuery = useProfileQuery()
  const filesQuery = useFilesQuery()
  const updateProfileMutation = useUpdateProfileMutation()
  const setAvatarMutation = useSetProfileAvatarMutation()
  const clearAvatarMutation = useClearProfileAvatarMutation()

  const profile = profileQuery.data
  const imageFiles = (filesQuery.data ?? []).filter((file) => file.mimeType.startsWith('image/'))

  useEffect(() => {
    if (profile) {
      form.setFieldsValue(toFormValues(profile))
    }
  }, [form, profile])

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

      {profileQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={t('profile.loadFailed')}
          description={profileQuery.error instanceof Error ? profileQuery.error.message : undefined}
          action={<Button onClick={() => void profileQuery.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}

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

                {imageFiles.length > 0 ? (
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
                  <Tag key={provider} icon={getProviderIcon(provider)} className="m-0 inline-flex items-center gap-1.5">
                    {t(getProviderLabelKey(provider))}
                  </Tag>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
