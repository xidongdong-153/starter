import type {
  AuthorizationPermission,
  AuthorizationRole,
  AuthorizationUser,
  CreateRoleInput,
  Permission,
  RoleCatalogStatus,
  UpdateRoleInput,
} from '@starter/contracts'
import type { TableProps, TreeDataNode } from 'antd'

import { PermissionKeys } from '@starter/contracts'

import {
  authorizationQueryKeys,
  useArchiveAuthorizationRoleMutation,
  useAuthorizationPermissionImpactQuery,
  useAuthorizationRoleImpactQuery,
  useAuthorizationRolesQuery,
  useAuthorizationUsersQuery,
  useCreateAuthorizationRoleMutation,
  useReplaceAuthorizationRolePermissionsMutation,
  useReplaceAuthorizationUserRolesMutation,
  useRestoreAuthorizationRoleMutation,
  useUpdateAuthorizationRoleMutation,
} from '@admin/api/authorization'
import { useAdminSessionQuery } from '@admin/api/auth'
import { isConflictError } from '@admin/api/http'
import { AdminPageHeader, PageToolbar, PermissionGuard } from '@admin/components/common'
import { RoleAssignmentDrawers } from '@admin/features/authorization/components/RoleAssignmentDrawers'
import { RoleFormDrawers } from '@admin/features/authorization/components/RoleFormDrawers'
import { RoleLifecycleOverlays } from '@admin/features/authorization/components/RoleLifecycleOverlays'
import { diffKeys } from '@admin/features/authorization/role-key'

import { useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Segmented, Table, Tabs, Tag, Tooltip } from 'antd'
import { Archive, ArchiveRestore, Eye, Pencil, Plus, UserCog } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface UserRoleDrawerState {
  user: AuthorizationUser | null
  checkedKeys: string[]
}

interface RolePermissionDrawerState {
  role: AuthorizationRole | null
  checkedKeys: string[]
}

function buildPermissionTreeData(permissions: AuthorizationPermission[]): TreeDataNode[] {
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
}

export function AuthorizationSettings() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const queryClient = useQueryClient()

  const [roleStatus, setRoleStatus] = useState<RoleCatalogStatus>('active')
  const [userRoleDrawer, setUserRoleDrawer] = useState<UserRoleDrawerState>({ user: null, checkedKeys: [] })
  const [rolePermissionDrawer, setRolePermissionDrawer] = useState<RolePermissionDrawerState>({
    role: null,
    checkedKeys: [],
  })
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false)
  const [metadataRole, setMetadataRole] = useState<AuthorizationRole | null>(null)
  const [permissionDiffOpen, setPermissionDiffOpen] = useState(false)
  const [roleImpactKey, setRoleImpactKey] = useState<string | null>(null)
  const [archiveRoleKey, setArchiveRoleKey] = useState<string | null>(null)
  const [restoreRole, setRestoreRole] = useState<AuthorizationRole | null>(null)
  const [permissionImpactKey, setPermissionImpactKey] = useState<Permission | null>(null)

  const sessionQuery = useAdminSessionQuery()
  const usersQuery = useAuthorizationUsersQuery()
  const rolesQuery = useAuthorizationRolesQuery(roleStatus)
  const activeRolesQuery = useAuthorizationRolesQuery('active')
  const replaceUserRolesMutation = useReplaceAuthorizationUserRolesMutation()
  const replaceRolePermissionsMutation = useReplaceAuthorizationRolePermissionsMutation()
  const createRoleMutation = useCreateAuthorizationRoleMutation()
  const updateRoleMutation = useUpdateAuthorizationRoleMutation()
  const archiveRoleMutation = useArchiveAuthorizationRoleMutation()
  const restoreRoleMutation = useRestoreAuthorizationRoleMutation()

  const editImpactQuery = useAuthorizationRoleImpactQuery(rolePermissionDrawer.role?.key ?? null)
  const roleImpactQuery = useAuthorizationRoleImpactQuery(roleImpactKey)
  const archiveImpactQuery = useAuthorizationRoleImpactQuery(archiveRoleKey)
  const permissionImpactQuery = useAuthorizationPermissionImpactQuery(permissionImpactKey)

  const roles = rolesQuery.data?.roles ?? []
  const permissions = activeRolesQuery.data?.permissions ?? []
  const activeRoles = activeRolesQuery.data?.roles ?? []

  const roleTreeData = useMemo<TreeDataNode[]>(
    () =>
      activeRoles.map((role) => ({
        key: role.key,
        title: (
          <span className="flex items-center gap-2">
            <span className="text-fg font-medium">{role.name}</span>
            <span className="text-fg-muted text-sm">({role.key})</span>
          </span>
        ),
      })),
    [activeRoles],
  )

  const permissionTreeData = useMemo<TreeDataNode[]>(() => buildPermissionTreeData(permissions), [permissions])

  const permissionDiff = useMemo(() => {
    if (!rolePermissionDrawer.role) return { added: [], removed: [] }
    const permissionKeySet = new Set<string>(permissions.map((permission) => permission.key))
    const checkedPermissionKeys = rolePermissionDrawer.checkedKeys.filter((key) => permissionKeySet.has(key))
    return diffKeys(rolePermissionDrawer.role.permissionKeys, checkedPermissionKeys)
  }, [rolePermissionDrawer, permissions])

  const openUserRoleDrawer = (user: AuthorizationUser) => {
    setUserRoleDrawer({ user, checkedKeys: [...user.roleKeys] })
  }

  const openRolePermissionDrawer = (role: AuthorizationRole) => {
    setRolePermissionDrawer({ role, checkedKeys: [...role.permissionKeys] })
  }

  const closeUserRoleDrawer = () => setUserRoleDrawer({ user: null, checkedKeys: [] })
  const closeRolePermissionDrawer = () => {
    setPermissionDiffOpen(false)
    setRolePermissionDrawer({ role: null, checkedKeys: [] })
  }

  const handleSaveUserRoles = async () => {
    if (!userRoleDrawer.user) return
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
      closeUserRoleDrawer()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('authorization.users.saveFailed'))
    }
  }

  const openPermissionDiff = () => {
    if (editImpactQuery.isSuccess) setPermissionDiffOpen(true)
  }

  const submitRolePermissions = async () => {
    if (!rolePermissionDrawer.role || !editImpactQuery.isSuccess) return

    const permissionByKey = new Map<string, Permission>(
      permissions.map((permission) => [permission.key, permission.key]),
    )
    const permissionKeys = rolePermissionDrawer.checkedKeys
      .map((key) => permissionByKey.get(key))
      .filter((permission): permission is Permission => permission !== undefined)

    try {
      await replaceRolePermissionsMutation.mutateAsync({
        roleKey: rolePermissionDrawer.role.key,
        values: { permissionKeys },
      })
      message.success(t('authorization.roles.saveSuccess'))
      closeRolePermissionDrawer()
    } catch (error) {
      setPermissionDiffOpen(false)
      message.error(error instanceof Error ? error.message : t('authorization.roles.saveFailed'))
    }
  }

  const handleCreateRole = async (input: CreateRoleInput): Promise<boolean> => {
    try {
      await createRoleMutation.mutateAsync(input)
      message.success(t('authorization.roles.createSuccess'))
      return true
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('authorization.roles.createFailed'))
      return false
    }
  }

  const handleUpdateRole = async (roleKey: string, input: UpdateRoleInput): Promise<boolean> => {
    try {
      await updateRoleMutation.mutateAsync({ roleKey, values: input })
      message.success(t('authorization.roles.metadataSaveSuccess'))
      return true
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('authorization.roles.metadataSaveFailed'))
      return false
    }
  }

  const handleArchive = async () => {
    if (!archiveRoleKey) return

    try {
      await archiveRoleMutation.mutateAsync({ roleKey: archiveRoleKey })
      message.success(t('authorization.roles.archiveSuccess'))
      setArchiveRoleKey(null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('authorization.roles.archiveFailed'))
      if (isConflictError(error)) {
        await Promise.allSettled([
          archiveImpactQuery.refetch(),
          queryClient.invalidateQueries({ queryKey: authorizationQueryKeys.rolesAll(), refetchType: 'all' }),
        ])
      }
    }
  }

  const handleRestore = async () => {
    if (!restoreRole) return

    try {
      await restoreRoleMutation.mutateAsync({ roleKey: restoreRole.key })
      message.success(t('authorization.roles.restoreSuccess'))
      setRestoreRole(null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('authorization.roles.restoreFailed'))
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
            const role = activeRoles.find((item) => item.key === roleKey)
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
                  disabled={isCurrentUser || replaceUserRolesMutation.isPending || !activeRolesQuery.isSuccess}
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

  const lifecyclePending =
    archiveRoleMutation.isPending || restoreRoleMutation.isPending || updateRoleMutation.isPending

  const roleColumns: TableProps<AuthorizationRole>['columns'] = [
    {
      key: 'role',
      title: t('authorization.roles.role'),
      render: (_, role) => (
        <div className="min-w-48">
          <div className="text-fg font-medium break-words">{role.name}</div>
          <div className="text-fg-muted mt-1 text-sm break-all">{role.key}</div>
          {role.description ? <div className="text-fg-muted mt-1 text-sm break-words">{role.description}</div> : null}
        </div>
      ),
    },
    {
      key: 'status',
      title: t('authorization.roles.status'),
      render: (_, role) => (
        <div className="flex flex-wrap gap-2">
          {role.isSystem ? <Tag className="m-0">{t('authorization.roles.system')}</Tag> : null}
          {role.archivedAt ? (
            <Tag color="orange" className="m-0">
              {t('authorization.roles.archived')}
            </Tag>
          ) : null}
          {!role.permissionsEditable && !role.archivedAt ? (
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
            const permission = permissions.find((item) => item.key === permissionKey)
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
        <div className="flex flex-wrap gap-2">
          <Tooltip title={t('authorization.roles.viewImpact')}>
            <Button
              icon={<Eye className="size-4" />}
              aria-label={t('authorization.roles.viewImpact')}
              onClick={() => setRoleImpactKey(role.key)}
            />
          </Tooltip>
          <PermissionGuard permission={PermissionKeys.AUTHORIZATION_MANAGE}>
            {role.metadataEditable ? (
              <Tooltip title={t('authorization.roles.editMetadata')}>
                <Button
                  icon={<Pencil className="size-4" />}
                  disabled={lifecyclePending}
                  aria-label={t('authorization.roles.editMetadata')}
                  onClick={() => setMetadataRole(role)}
                />
              </Tooltip>
            ) : null}
            {role.permissionsEditable ? (
              <Tooltip title={t('authorization.roles.edit')}>
                <Button
                  icon={<UserCog className="size-4" />}
                  disabled={replaceRolePermissionsMutation.isPending}
                  aria-label={t('authorization.roles.edit')}
                  onClick={() => openRolePermissionDrawer(role)}
                />
              </Tooltip>
            ) : null}
            {role.lifecycleEditable && !role.archivedAt ? (
              <Tooltip title={t('authorization.roles.archive')}>
                <Button
                  icon={<Archive className="size-4" />}
                  disabled={lifecyclePending}
                  aria-label={t('authorization.roles.archive')}
                  onClick={() => setArchiveRoleKey(role.key)}
                />
              </Tooltip>
            ) : null}
            {role.lifecycleEditable && role.archivedAt ? (
              <Tooltip title={t('authorization.roles.restore')}>
                <Button
                  icon={<ArchiveRestore className="size-4" />}
                  disabled={lifecyclePending}
                  aria-label={t('authorization.roles.restore')}
                  onClick={() => setRestoreRole(role)}
                />
              </Tooltip>
            ) : null}
            {!role.metadataEditable && !role.permissionsEditable && !role.lifecycleEditable ? (
              <span className="text-fg-muted self-center text-sm">{t('authorization.roles.readOnly')}</span>
            ) : null}
          </PermissionGuard>
        </div>
      ),
    },
  ]

  const permissionColumns: TableProps<AuthorizationPermission>['columns'] = [
    {
      key: 'permission',
      title: t('authorization.permissionsTab.permission'),
      render: (_, permission) => (
        <div className="min-w-48">
          <div className="text-fg font-medium break-all">{permission.key}</div>
          {permission.description ? (
            <div className="text-fg-muted mt-1 text-sm break-words">{permission.description}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions',
      title: t('authorization.actions'),
      render: (_, permission) => (
        <Tooltip title={t('authorization.permissionsTab.viewImpact')}>
          <Button
            icon={<Eye className="size-4" />}
            aria-label={t('authorization.permissionsTab.viewImpact')}
            onClick={() => setPermissionImpactKey(permission.key)}
          />
        </Tooltip>
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented<RoleCatalogStatus>
              value={roleStatus}
              onChange={setRoleStatus}
              options={[
                { label: t('authorization.roles.statusActive'), value: 'active' },
                { label: t('authorization.roles.statusArchived'), value: 'archived' },
              ]}
            />
            <PermissionGuard permission={PermissionKeys.AUTHORIZATION_MANAGE}>
              <Button
                type="primary"
                icon={<Plus className="size-4" />}
                disabled={!activeRolesQuery.isSuccess}
                onClick={() => setCreateDrawerOpen(true)}
              >
                {t('authorization.roles.create')}
              </Button>
            </PermissionGuard>
          </div>
          <Table<AuthorizationRole>
            rowKey="key"
            columns={roleColumns}
            dataSource={roles}
            loading={rolesQuery.isLoading}
            locale={{ emptyText: t('authorization.roles.empty') }}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        </div>
      ),
    },
    {
      key: 'permissions',
      label: t('authorization.tabs.permissions'),
      children: (
        <Table<AuthorizationPermission>
          rowKey="key"
          columns={permissionColumns}
          dataSource={activeRolesQuery.data?.permissions ?? []}
          loading={activeRolesQuery.isLoading}
          locale={{ emptyText: t('authorization.permissionsTab.empty') }}
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <AdminPageHeader title={t('authorization.title')} description={t('authorization.description')} />
        <PageToolbar
          summaryItems={[
            { label: t('authorization.summary.users'), value: usersQuery.data?.length ?? 0 },
            { label: t('authorization.summary.roles'), value: roles.length },
            { label: t('authorization.summary.permissions'), value: permissions.length },
          ]}
        />
      </div>

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

      {roleStatus !== 'active' && activeRolesQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={t('authorization.roles.activeCatalogLoadFailed')}
          description={activeRolesQuery.error instanceof Error ? activeRolesQuery.error.message : undefined}
          action={<Button onClick={() => void activeRolesQuery.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}

      <section className="min-w-0">
        <Tabs items={tabItems} />
      </section>

      <PermissionGuard permission={PermissionKeys.AUTHORIZATION_MANAGE}>
        <RoleAssignmentDrawers
          permissionDiff={permissionDiff}
          permissionDiffOpen={permissionDiffOpen}
          permissionTreeData={permissionTreeData}
          roleImpact={{
            assignedUserCount: editImpactQuery.data?.assignedUserCount,
            isError: editImpactQuery.isError,
            isFetching: editImpactQuery.isFetching,
            isLoading: editImpactQuery.isLoading,
            isSuccess: editImpactQuery.isSuccess,
            retry: () => void editImpactQuery.refetch(),
          }}
          rolePermission={{ item: rolePermissionDrawer.role, checkedKeys: rolePermissionDrawer.checkedKeys }}
          rolePermissionPending={replaceRolePermissionsMutation.isPending}
          roleTreeData={roleTreeData}
          userRole={{ item: userRoleDrawer.user, checkedKeys: userRoleDrawer.checkedKeys }}
          userRolePending={replaceUserRolesMutation.isPending}
          onChangeRolePermissions={(checkedKeys) =>
            setRolePermissionDrawer((previous) => ({ ...previous, checkedKeys }))
          }
          onChangeUserRoles={(checkedKeys) => setUserRoleDrawer((previous) => ({ ...previous, checkedKeys }))}
          onClosePermissionDiff={() => setPermissionDiffOpen(false)}
          onCloseRolePermission={closeRolePermissionDrawer}
          onCloseUserRole={closeUserRoleDrawer}
          onOpenPermissionDiff={openPermissionDiff}
          onSaveRolePermissions={() => void submitRolePermissions()}
          onSaveUserRoles={() => void handleSaveUserRoles()}
        />

        <RoleFormDrawers
          createOpen={createDrawerOpen}
          createPending={createRoleMutation.isPending}
          metadataRole={metadataRole}
          permissionTreeData={permissionTreeData}
          permissions={permissions}
          updatePending={updateRoleMutation.isPending}
          onCloseCreate={() => setCreateDrawerOpen(false)}
          onCloseMetadata={() => setMetadataRole(null)}
          onCreate={handleCreateRole}
          onUpdate={handleUpdateRole}
        />
      </PermissionGuard>

      <RoleLifecycleOverlays
        archiveImpact={{
          assignedUserCount: archiveImpactQuery.data?.assignedUserCount,
          isError: archiveImpactQuery.isError,
          isFetching: archiveImpactQuery.isFetching,
          isLoading: archiveImpactQuery.isLoading,
          retry: () => void archiveImpactQuery.refetch(),
        }}
        archivePending={archiveRoleMutation.isPending}
        archiveRoleKey={archiveRoleKey}
        permissionImpact={{
          affectedUserCount: permissionImpactQuery.data?.affectedUserCount,
          isError: permissionImpactQuery.isError,
          isLoading: permissionImpactQuery.isLoading,
          retry: () => void permissionImpactQuery.refetch(),
          roleKeys: permissionImpactQuery.data?.roleKeys,
        }}
        permissionImpactKey={permissionImpactKey}
        restorePending={restoreRoleMutation.isPending}
        restoreRoleName={restoreRole?.name ?? null}
        roleImpact={{
          assignedUserCount: roleImpactQuery.data?.assignedUserCount,
          isError: roleImpactQuery.isError,
          isFetching: roleImpactQuery.isFetching,
          isLoading: roleImpactQuery.isLoading,
          retry: () => void roleImpactQuery.refetch(),
        }}
        roleImpactKey={roleImpactKey}
        onArchive={() => void handleArchive()}
        onCloseArchive={() => setArchiveRoleKey(null)}
        onClosePermissionImpact={() => setPermissionImpactKey(null)}
        onCloseRestore={() => setRestoreRole(null)}
        onCloseRoleImpact={() => setRoleImpactKey(null)}
        onRestore={() => void handleRestore()}
      />
    </div>
  )
}
