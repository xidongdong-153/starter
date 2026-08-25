import type { UserManagementQuery, UserManagementUser, UserManagementUserDetail, UserStatus } from '@starter/contracts'
import type { TableProps } from 'antd'

import { useAuthorizationRolesQuery } from '@admin/api/authorization'
import { useUpdateUserStatusMutation, useUsersListQuery, useUserDetailQuery } from '@admin/api/users'
import { AdminPageHeader, PageToolbar } from '@admin/components/common'

import { Alert, Button, Drawer, Input, message, Popconfirm, Select, Space, Table, Tag, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { Eye, RotateCcw, Search } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function UserManagement() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [search, setSearch] = useState('')
  const [roleKey, setRoleKey] = useState<string | undefined>(undefined)
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined)

  const query: UserManagementQuery = useMemo(
    () => ({
      page,
      pageSize,
      search: search || undefined,
      roleKey,
    }),
    [page, pageSize, search, roleKey],
  )

  const rolesQuery = useAuthorizationRolesQuery()
  const listQuery = useUsersListQuery(query)
  const detailQuery = useUserDetailQuery(selectedUserId)
  const updateStatusMutation = useUpdateUserStatusMutation()

  const roles = rolesQuery.data?.roles ?? []

  const handleUpdateStatus = useCallback(
    async (userId: string, status: UserStatus) => {
      try {
        await updateStatusMutation.mutateAsync({ userId, status })
        message.success(status === 'suspended' ? t('users.disableSuccess') : t('users.enableSuccess'))
      } catch (error) {
        message.error(error instanceof Error ? error.message : t('users.statusUpdateFailed'))
      }
    },
    [t, updateStatusMutation],
  )

  const handleSearch = (value: string) => {
    setSearch(value.trim())
    setPage(1)
  }

  const handleRoleChange = (value: string | undefined) => {
    setRoleKey(value)
    setPage(1)
  }

  const handleClearFilters = () => {
    setSearch('')
    setRoleKey(undefined)
    setPage(1)
  }

  const handlePageChange = (newPage: number, newPageSize: number) => {
    setPage(newPage)
    setPageSize(newPageSize)
  }

  const handleOpenDetail = (userId: string) => {
    setSelectedUserId(userId)
  }

  const handleCloseDetail = () => {
    setSelectedUserId(undefined)
  }

  const roleOptions = roles.map((role) => ({
    label: `${role.name} (${role.key})`,
    value: role.key,
  }))

  const columns: TableProps<UserManagementUser>['columns'] = useMemo(
    () => [
      {
        key: 'user',
        title: t('users.table.name'),
        render: (_, user) => (
          <div className="min-w-52">
            <div className="text-fg font-medium break-words">{user.name}</div>
            <div className="text-fg-muted mt-1 text-sm break-all">{user.email}</div>
          </div>
        ),
      },
      {
        dataIndex: 'roleKeys',
        key: 'roleKeys',
        title: t('users.table.roles'),
        render: (roleKeys: string[]) => (
          <div className="flex max-w-xl flex-wrap gap-2">
            {roleKeys.length === 0 ? (
              <span className="text-fg-muted text-sm">—</span>
            ) : (
              roleKeys.map((key) => {
                const role = roles.find((r) => r.key === key)
                return (
                  <Tag key={key} className="m-0">
                    {role?.name ?? key}
                  </Tag>
                )
              })
            )}
          </div>
        ),
      },
      {
        dataIndex: 'emailVerified',
        key: 'emailVerified',
        title: t('users.table.emailVerified'),
        render: (verified: boolean) => (
          <Tag color={verified ? 'success' : 'default'} className="m-0">
            {verified ? t('users.emailVerifiedYes') : t('users.emailVerifiedNo')}
          </Tag>
        ),
      },
      {
        dataIndex: 'status',
        key: 'status',
        title: t('users.table.status'),
        render: (status: UserStatus) => (
          <Tag color={status === 'suspended' ? 'error' : 'success'} className="m-0">
            {status === 'suspended' ? t('users.statusSuspended') : t('users.statusActive')}
          </Tag>
        ),
      },
      {
        dataIndex: 'createdAt',
        key: 'createdAt',
        title: t('users.table.createdAt'),
        render: (createdAt: string) => (
          <span className="text-fg-muted text-sm">{dayjs(createdAt).format('YYYY-MM-DD')}</span>
        ),
      },
      {
        key: 'actions',
        title: t('users.table.actions'),
        render: (_, user) => (
          <Space size={4}>
            <Tooltip title={t('users.viewDetail')}>
              <Button
                icon={<Eye className="size-4" />}
                aria-label={t('users.viewDetail')}
                onClick={() => handleOpenDetail(user.id)}
              />
            </Tooltip>
            {user.status === 'suspended' ? (
              <Button size="small" onClick={() => void handleUpdateStatus(user.id, 'active')}>
                {t('users.enable')}
              </Button>
            ) : (
              <Popconfirm
                title={t('users.disableConfirm')}
                okText={t('users.disable')}
                cancelText={t('common.cancel')}
                onConfirm={() => void handleUpdateStatus(user.id, 'suspended')}
              >
                <Button size="small" danger>
                  {t('users.disable')}
                </Button>
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ],
    [roles, t, handleUpdateStatus],
  )

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <AdminPageHeader title={t('users.title')} description="" />
        <PageToolbar
          filters={
            <Space wrap>
              <Input.Search
                placeholder={t('users.searchPlaceholder')}
                allowClear
                enterButton={<Search className="size-4" />}
                onSearch={handleSearch}
                style={{ width: 280 }}
              />
              <Select
                placeholder={t('users.roleFilterPlaceholder')}
                allowClear
                options={roleOptions}
                value={roleKey}
                onChange={handleRoleChange}
                style={{ width: 200 }}
                loading={rolesQuery.isLoading}
              />
              <Button icon={<RotateCcw className="size-4" />} onClick={handleClearFilters}>
                {t('users.clearFilters')}
              </Button>
            </Space>
          }
        />
      </div>

      {listQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={listQuery.error instanceof Error ? listQuery.error.message : t('common.cancel')}
          action={<Button onClick={() => void listQuery.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}

      <Table<UserManagementUser>
        rowKey="id"
        columns={columns}
        dataSource={listQuery.data?.items ?? []}
        loading={listQuery.isLoading}
        pagination={{
          current: page,
          pageSize,
          total: listQuery.data?.total ?? 0,
          showSizeChanger: true,
          showTotal: (total) => t('users.total', { count: total }),
          onChange: handlePageChange,
        }}
        locale={{ emptyText: t('users.table.empty') }}
        scroll={{ x: 'max-content' }}
      />

      <Drawer
        title={t('users.detailTitle')}
        placement="right"
        open={Boolean(selectedUserId)}
        size="default"
        onClose={handleCloseDetail}
        width={520}
      >
        {detailQuery.isLoading ? (
          <div className="text-fg-muted text-sm">{t('common.loadingTitle')}</div>
        ) : detailQuery.error ? (
          <Alert
            showIcon
            type="error"
            message={detailQuery.error instanceof Error ? detailQuery.error.message : t('common.cancel')}
            action={<Button onClick={() => void detailQuery.refetch()}>{t('common.retry')}</Button>}
          />
        ) : detailQuery.data ? (
          <UserDetail data={detailQuery.data} />
        ) : (
          <Alert showIcon type="warning" message={t('users.notFound')} />
        )}
      </Drawer>
    </div>
  )
}

interface UserDetailProps {
  data: UserManagementUserDetail
}

function UserDetail({ data }: UserDetailProps) {
  const { t } = useTranslation()

  const providerNames: Record<string, string> = {
    credential: t('profile.provider.credential'),
    github: t('profile.provider.github'),
    google: t('profile.provider.google'),
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-fg mb-3 font-medium">{t('users.basicInfo')}</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-fg-muted">{t('users.name')}</span>
            <span className="text-fg">{data.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-muted">{t('users.email')}</span>
            <span className="text-fg break-all">{data.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-muted">{t('users.emailVerified')}</span>
            <Tag color={data.emailVerified ? 'success' : 'default'} className="m-0">
              {data.emailVerified ? t('users.emailVerifiedYes') : t('users.emailVerifiedNo')}
            </Tag>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-muted">{t('users.status')}</span>
            <Tag color={data.status === 'suspended' ? 'error' : 'success'} className="m-0">
              {data.status === 'suspended' ? t('users.statusSuspended') : t('users.statusActive')}
            </Tag>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-muted">{t('users.roles')}</span>
            <div className="flex flex-wrap justify-end gap-1">
              {data.roleKeys.length === 0 ? (
                <span className="text-fg-muted text-sm">—</span>
              ) : (
                data.roleKeys.map((key) => (
                  <Tag key={key} className="m-0">
                    {key}
                  </Tag>
                ))
              )}
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-muted">{t('users.createdAt')}</span>
            <span className="text-fg">{dayjs(data.createdAt).format('YYYY-MM-DD')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-muted">{t('users.updateTime')}</span>
            <span className="text-fg">{dayjs(data.updatedAt).format('YYYY-MM-DD')}</span>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-fg mb-3 font-medium">{t('users.providers')}</h3>
        <div className="flex flex-wrap gap-2">
          {data.providers.length === 0 ? (
            <span className="text-fg-muted text-sm">—</span>
          ) : (
            data.providers.map((provider) => (
              <Tag key={provider} className="m-0">
                {providerNames[provider] ?? provider}
              </Tag>
            ))
          )}
        </div>
      </section>

      <section>
        <h3 className="text-fg mb-3 font-medium">{t('users.profile')}</h3>
        {data.profile === null ? (
          <span className="text-fg-muted text-sm">{t('users.noProfile')}</span>
        ) : (
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-fg-muted">{t('users.bio')}:</span>
              <p className="text-fg mt-1">{data.profile.bio || '—'}</p>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">{t('users.contactEmail')}</span>
              <span className="text-fg break-all">{data.profile.contactEmail || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">{t('users.location')}</span>
              <span className="text-fg">{data.profile.location || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">{t('users.availableForWork')}</span>
              <Tag color={data.profile.availableForWork ? 'success' : 'default'} className="m-0">
                {data.profile.availableForWork ? t('users.availableForWorkYes') : t('users.availableForWorkNo')}
              </Tag>
            </div>
            {data.profile.socialLinks.length > 0 && (
              <div>
                <span className="text-fg-muted">{t('users.socialLinks')}:</span>
                <ul className="mt-1 space-y-1">
                  {data.profile.socialLinks.map((link) => (
                    <li key={link}>
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent break-all text-sm"
                      >
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.profile.avatarUrl && (
              <div>
                <span className="text-fg-muted">{t('users.avatar')}:</span>
                <div className="mt-1">
                  <img
                    src={data.profile.avatarUrl}
                    alt={t('users.avatar')}
                    className="size-16 rounded-full object-cover"
                  />
                </div>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-fg-muted">{t('users.updateTime')}</span>
              <span className="text-fg">
                {data.profile.updatedAt ? dayjs(data.profile.updatedAt).format('YYYY-MM-DD') : '—'}
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
