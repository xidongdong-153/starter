import { PermissionKeys, type AuthorizationRole, type AuthorizationUser, type Permission } from '@starter/contracts'
import type { TableProps, TreeDataNode } from 'antd'

import {
  useAuthorizationRolesQuery,
  useAuthorizationUsersQuery,
  useReplaceAuthorizationRolePermissionsMutation,
  useReplaceAuthorizationUserRolesMutation,
} from '@admin/api/authorization'
import { useAdminSessionQuery } from '@admin/api/auth'
import { AdminPageHeader, PermissionGuard } from '@admin/components/common'

import { Alert, App, Button, Drawer, Table, Tabs, Tag, Tooltip, Tree } from 'antd'
import { Pencil, UserCog } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface UserRoleDrawerState {
  open: boolean
  user: AuthorizationUser | null
  checkedKeys: string[]
}

interface RolePermissionDrawerState {
  open: boolean
  role: AuthorizationRole | null
  checkedKeys: string[]
}

const drawerClassNames = {
  body: 'bg-surface',
  footer: 'bg-surface-muted border-border',
  header: 'bg-surface-muted border-border text-fg',
  wrapper: 'text-fg',
}

const drawerStyles = {
  footer: {
    borderTop: '1px solid var(--color-border)',
  },
  header: {
    borderBottom: '1px solid var(--color-border)',
    color: 'var(--color-fg)',
  },
  mask: {
    backgroundColor: 'color-mix(in oklab, var(--color-surface-subtle) 52%, transparent)',
  },
}

export function AuthorizationSettings() {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const [userRoleDrawer, setUserRoleDrawer] = useState<UserRoleDrawerState>({
    open: false,
    user: null,
    checkedKeys: [],
  })
  const [rolePermissionDrawer, setRolePermissionDrawer] = useState<RolePermissionDrawerState>({
    open: false,
    role: null,
    checkedKeys: [],
  })

  const sessionQuery = useAdminSessionQuery()
  const usersQuery = useAuthorizationUsersQuery()
  const rolesQuery = useAuthorizationRolesQuery()
  const replaceUserRolesMutation = useReplaceAuthorizationUserRolesMutation()
  const replaceRolePermissionsMutation = useReplaceAuthorizationRolePermissionsMutation()

  const roles = rolesQuery.data?.roles ?? []
  const permissions = rolesQuery.data?.permissions ?? []

  const roleTreeData = useMemo<TreeDataNode[]>(
    () =>
      roles.map((role) => ({
        key: role.key,
        title: (
          <span className="flex items-center gap-2">
            <span className="text-fg font-medium">{role.name}</span>
            <span className="text-fg-muted text-sm">({role.key})</span>
          </span>
        ),
      })),
    [roles],
  )

  const permissionTreeData = useMemo<TreeDataNode[]>(() => {
    const resourceMap = new Map<
      string,
      { key: string; title: React.ReactNode; children: { key: string; title: React.ReactNode }[] }
    >()

    for (const permission of permissions) {
      if (!resourceMap.has(permission.resource)) {
        resourceMap.set(permission.resource, {
          key: permission.resource,
          title: <span className="text-fg font-medium">{permission.resource}</span>,
          children: [],
        })
      }
      resourceMap.get(permission.resource)!.children.push({
        key: permission.key,
        title: (
          <span className="flex flex-col">
            <span className="text-fg">{permission.action}</span>
            {permission.description && <span className="text-fg-muted text-sm">{permission.description}</span>}
          </span>
        ),
      })
    }

    return Array.from(resourceMap.values())
  }, [permissions])

  const openUserRoleDrawer = (user: AuthorizationUser) => {
    setUserRoleDrawer({
      open: true,
      user,
      checkedKeys: [...user.roleKeys],
    })
  }

  const openRolePermissionDrawer = (role: AuthorizationRole) => {
    setRolePermissionDrawer({
      open: true,
      role,
      checkedKeys: [...role.permissionKeys],
    })
  }

  const handleSaveUserRoles = async () => {
    if (!userRoleDrawer.user) {
      return
    }

    if (userRoleDrawer.checkedKeys.length === 0) {
      message.error(t('authorization.users.roleRequired'))
      return
    }

    try {
      await replaceUserRolesMutation.mutateAsync({
        userId: userRoleDrawer.user.id,
        values: { roleKeys: userRoleDrawer.checkedKeys },
      })
      message.success(t('authorization.users.saveSuccess'))
      setUserRoleDrawer({ open: false, user: null, checkedKeys: [] })
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('authorization.users.saveFailed'))
    }
  }

  const handleSaveRolePermissions = async () => {
    if (!rolePermissionDrawer.role) {
      return
    }

    try {
      const permissionKeys = rolePermissionDrawer.checkedKeys.filter((key) =>
        permissions.some((p) => p.key === key),
      ) as Permission[]

      await replaceRolePermissionsMutation.mutateAsync({
        roleKey: rolePermissionDrawer.role.key,
        values: { permissionKeys },
      })
      message.success(t('authorization.roles.saveSuccess'))
      setRolePermissionDrawer({ open: false, role: null, checkedKeys: [] })
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('authorization.roles.saveFailed'))
    }
  }

  const userColumns: TableProps<AuthorizationUser>['columns'] = [
    {
      key: 'user',
      title: t('authorization.users.user'),
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
      title: t('authorization.users.roles'),
      render: (roleKeys: string[]) => (
        <div className="flex max-w-xl flex-wrap gap-2">
          {roleKeys.map((roleKey) => {
            const role = roles.find((r) => r.key === roleKey)
            return (
              <Tag key={roleKey} className="m-0">
                {role?.name ?? roleKey}
              </Tag>
            )
          })}
        </div>
      ),
    },
    {
      key: 'actions',
      title: t('authorization.actions'),
      render: (_, user) => {
        const isCurrentUser = sessionQuery.data?.user.id === user.id

        return (
          <PermissionGuard permission={PermissionKeys.AUTHORIZATION_MANAGE}>
            <Tooltip title={isCurrentUser ? t('authorization.users.selfEditDisabled') : undefined}>
              <span>
                <Button
                  icon={<UserCog className="size-4" />}
                  disabled={isCurrentUser || replaceUserRolesMutation.isPending || rolesQuery.isError}
                  aria-label={t('authorization.users.edit')}
                  onClick={() => openUserRoleDrawer(user)}
                />
              </span>
            </Tooltip>
          </PermissionGuard>
        )
      },
    },
  ]

  const roleColumns: TableProps<AuthorizationRole>['columns'] = [
    {
      key: 'role',
      title: t('authorization.roles.role'),
      render: (_, role) => (
        <div className="min-w-48">
          <div className="text-fg font-medium break-words">{role.name}</div>
          <div className="text-fg-muted mt-1 text-sm break-all">{role.key}</div>
        </div>
      ),
    },
    {
      key: 'status',
      title: t('authorization.roles.status'),
      render: (_, role) => (
        <div className="flex flex-wrap gap-2">
          {role.isSystem ? <Tag className="m-0">{t('authorization.roles.system')}</Tag> : null}
          {!role.permissionsEditable ? (
            <Tag color="blue" className="m-0">
              {t('authorization.roles.protected')}
            </Tag>
          ) : null}
        </div>
      ),
    },
    {
      dataIndex: 'permissionKeys',
      key: 'permissionKeys',
      title: t('authorization.roles.permissions'),
      render: (permissionKeys: AuthorizationRole['permissionKeys']) => (
        <div className="flex max-w-2xl flex-wrap gap-2">
          {permissionKeys.map((permissionKey) => {
            const permission = permissions.find((p) => p.key === permissionKey)
            return (
              <Tag key={permissionKey} className="m-0 max-w-full whitespace-normal">
                {permission?.action ?? permissionKey}
              </Tag>
            )
          })}
        </div>
      ),
    },
    {
      key: 'actions',
      title: t('authorization.actions'),
      render: (_, role) => (
        <PermissionGuard permission={PermissionKeys.AUTHORIZATION_MANAGE}>
          {role.permissionsEditable ? (
            <Button
              icon={<Pencil className="size-4" />}
              disabled={replaceRolePermissionsMutation.isPending}
              aria-label={t('authorization.roles.edit')}
              onClick={() => openRolePermissionDrawer(role)}
            />
          ) : (
            <span className="text-fg-muted text-sm">{t('authorization.roles.readOnly')}</span>
          )}
        </PermissionGuard>
      ),
    },
  ]

  const tabItems = [
    {
      key: 'users',
      label: t('authorization.tabs.users'),
      children: (
        <Table<AuthorizationUser>
          rowKey="id"
          columns={userColumns}
          dataSource={usersQuery.data ?? []}
          loading={usersQuery.isLoading}
          locale={{ emptyText: t('authorization.users.empty') }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          scroll={{ x: 'max-content' }}
        />
      ),
    },
    {
      key: 'roles',
      label: t('authorization.tabs.roles'),
      children: (
        <Table<AuthorizationRole>
          rowKey="key"
          columns={roleColumns}
          dataSource={roles}
          loading={rolesQuery.isLoading}
          locale={{ emptyText: t('authorization.roles.empty') }}
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t('authorization.title')}
        description={t('authorization.description')}
        summaryItems={[
          { label: t('authorization.summary.users'), value: usersQuery.data?.length ?? 0 },
          { label: t('authorization.summary.roles'), value: roles.length },
          { label: t('authorization.summary.permissions'), value: permissions.length },
        ]}
      />

      {usersQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={t('authorization.users.loadFailed')}
          description={usersQuery.error instanceof Error ? usersQuery.error.message : undefined}
          action={<Button onClick={() => void usersQuery.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}

      {rolesQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={t('authorization.roles.loadFailed')}
          description={rolesQuery.error instanceof Error ? rolesQuery.error.message : undefined}
          action={<Button onClick={() => void rolesQuery.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}

      <section className="min-w-0">
        <Tabs items={tabItems} />
      </section>

      <PermissionGuard permission={PermissionKeys.AUTHORIZATION_MANAGE}>
        <Drawer
          title={t('authorization.users.editTitle', { name: userRoleDrawer.user?.name ?? '' })}
          placement="right"
          open={userRoleDrawer.open}
          size="default"
          classNames={drawerClassNames}
          styles={drawerStyles}
          onClose={() => setUserRoleDrawer({ open: false, user: null, checkedKeys: [] })}
          footer={
            <div className="flex justify-end gap-2">
              <Button onClick={() => setUserRoleDrawer({ open: false, user: null, checkedKeys: [] })}>
                {t('common.cancel')}
              </Button>
              <Button
                type="primary"
                loading={replaceUserRolesMutation.isPending}
                onClick={() => void handleSaveUserRoles()}
              >
                {t('common.save')}
              </Button>
            </div>
          }
        >
          <div className="mb-3 text-fg-muted text-sm">{t('authorization.users.roles')}</div>
          <Tree
            checkable
            defaultExpandAll
            selectable={false}
            treeData={roleTreeData}
            checkedKeys={userRoleDrawer.checkedKeys}
            onCheck={(checked) => {
              const keys = Array.isArray(checked) ? checked : checked.checked
              setUserRoleDrawer((prev) => ({ ...prev, checkedKeys: keys as string[] }))
            }}
          />
        </Drawer>
      </PermissionGuard>

      <PermissionGuard permission={PermissionKeys.AUTHORIZATION_MANAGE}>
        <Drawer
          title={t('authorization.roles.editTitle', { name: rolePermissionDrawer.role?.name ?? '' })}
          placement="right"
          open={rolePermissionDrawer.open}
          size="large"
          classNames={drawerClassNames}
          styles={drawerStyles}
          onClose={() => setRolePermissionDrawer({ open: false, role: null, checkedKeys: [] })}
          footer={
            <div className="flex justify-end gap-2">
              <Button onClick={() => setRolePermissionDrawer({ open: false, role: null, checkedKeys: [] })}>
                {t('common.cancel')}
              </Button>
              <Button
                type="primary"
                loading={replaceRolePermissionsMutation.isPending}
                onClick={() => void handleSaveRolePermissions()}
              >
                {t('common.save')}
              </Button>
            </div>
          }
        >
          <div className="mb-3 text-fg-muted text-sm">{t('authorization.roles.permissions')}</div>
          <Tree
            checkable
            defaultExpandAll
            selectable={false}
            treeData={permissionTreeData}
            checkedKeys={rolePermissionDrawer.checkedKeys}
            onCheck={(checked) => {
              const keys = Array.isArray(checked) ? checked : checked.checked
              setRolePermissionDrawer((prev) => ({ ...prev, checkedKeys: keys as string[] }))
            }}
          />
        </Drawer>
      </PermissionGuard>
    </div>
  )
}
