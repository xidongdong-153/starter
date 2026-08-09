import type { AuthorizationRole, AuthorizationUser } from '@starter/contracts'
import type { TableProps } from 'antd'

import {
  useAuthorizationRolesQuery,
  useAuthorizationUsersQuery,
  useReplaceAuthorizationRolePermissionsMutation,
  useReplaceAuthorizationUserRolesMutation,
} from '@admin/api/authorization'
import { useAdminSessionQuery } from '@admin/api/auth'
import { AdminPageHeader, PermissionGuard } from '@admin/components/common'
import { PermissionKeys } from '@starter/contracts'
import { Alert, App, Button, Checkbox, Form, Modal, Table, Tabs, Tag, Tooltip } from 'antd'
import { Pencil, UserCog } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface UserRoleFormValues {
  roleKeys: string[]
}

interface RolePermissionFormValues {
  permissionKeys: AuthorizationRole['permissionKeys']
}

export function AuthorizationSettings() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [userRoleForm] = Form.useForm<UserRoleFormValues>()
  const [rolePermissionForm] = Form.useForm<RolePermissionFormValues>()
  const [editingUser, setEditingUser] = useState<AuthorizationUser | null>(null)
  const [editingRole, setEditingRole] = useState<AuthorizationRole | null>(null)

  const sessionQuery = useAdminSessionQuery()
  const usersQuery = useAuthorizationUsersQuery()
  const rolesQuery = useAuthorizationRolesQuery()
  const replaceUserRolesMutation = useReplaceAuthorizationUserRolesMutation()
  const replaceRolePermissionsMutation = useReplaceAuthorizationRolePermissionsMutation()

  const roles = rolesQuery.data?.roles ?? []
  const permissions = rolesQuery.data?.permissions ?? []

  const openUserEditor = (user: AuthorizationUser) => {
    setEditingUser(user)
    userRoleForm.setFieldsValue({ roleKeys: user.roleKeys })
  }

  const openRoleEditor = (role: AuthorizationRole) => {
    setEditingRole(role)
    rolePermissionForm.setFieldsValue({ permissionKeys: role.permissionKeys })
  }

  const handleSaveUserRoles = async (values: UserRoleFormValues) => {
    if (!editingUser) {
      return
    }

    try {
      await replaceUserRolesMutation.mutateAsync({
        userId: editingUser.id,
        values: { roleKeys: values.roleKeys },
      })
      message.success(t('authorization.users.saveSuccess'))
      setEditingUser(null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('authorization.users.saveFailed'))
    }
  }

  const handleSaveRolePermissions = async (values: RolePermissionFormValues) => {
    if (!editingRole) {
      return
    }

    try {
      await replaceRolePermissionsMutation.mutateAsync({
        roleKey: editingRole.key,
        values: { permissionKeys: values.permissionKeys ?? [] },
      })
      message.success(t('authorization.roles.saveSuccess'))
      setEditingRole(null)
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
          {roleKeys.map((roleKey) => (
            <Tag key={roleKey} className="m-0">
              {roleKey}
            </Tag>
          ))}
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
                  onClick={() => openUserEditor(user)}
                >
                  {t('authorization.users.edit')}
                </Button>
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
          {permissionKeys.map((permissionKey) => (
            <Tag key={permissionKey} className="m-0 max-w-full whitespace-normal">
              {permissionKey}
            </Tag>
          ))}
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
              onClick={() => openRoleEditor(role)}
            >
              {t('authorization.roles.edit')}
            </Button>
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
        <Modal
          destroyOnHidden
          title={t('authorization.users.editTitle', { name: editingUser?.name ?? '' })}
          open={Boolean(editingUser)}
          okText={t('common.save')}
          cancelText={t('common.cancel')}
          confirmLoading={replaceUserRolesMutation.isPending}
          onCancel={() => setEditingUser(null)}
          onOk={() => void userRoleForm.submit()}
        >
          <Form<UserRoleFormValues> form={userRoleForm} layout="vertical" onFinish={handleSaveUserRoles}>
            <Form.Item
              name="roleKeys"
              label={t('authorization.users.roles')}
              rules={[{ required: true, message: t('authorization.users.roleRequired') }]}
            >
              <Checkbox.Group
                className="grid gap-3"
                options={roles.map((role) => ({ label: `${role.name} (${role.key})`, value: role.key }))}
              />
            </Form.Item>
          </Form>
        </Modal>
      </PermissionGuard>

      <PermissionGuard permission={PermissionKeys.AUTHORIZATION_MANAGE}>
        <Modal
          destroyOnHidden
          width={720}
          title={t('authorization.roles.editTitle', { name: editingRole?.name ?? '' })}
          open={Boolean(editingRole)}
          okText={t('common.save')}
          cancelText={t('common.cancel')}
          confirmLoading={replaceRolePermissionsMutation.isPending}
          onCancel={() => setEditingRole(null)}
          onOk={() => void rolePermissionForm.submit()}
        >
          <Form<RolePermissionFormValues>
            form={rolePermissionForm}
            layout="vertical"
            onFinish={handleSaveRolePermissions}
          >
            <Form.Item name="permissionKeys" label={t('authorization.roles.permissions')}>
              <Checkbox.Group className="grid gap-3">
                {permissions.map((permission) => (
                  <Checkbox key={permission.key} value={permission.key} className="min-w-0 items-start">
                    <span className="block break-all">{permission.key}</span>
                    {permission.description ? (
                      <span className="text-fg-muted mt-1 block text-sm break-words">{permission.description}</span>
                    ) : null}
                  </Checkbox>
                ))}
              </Checkbox.Group>
            </Form.Item>
          </Form>
        </Modal>
      </PermissionGuard>
    </div>
  )
}
