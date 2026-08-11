import type { AuthorizationRole, AuthorizationUser } from '@starter/contracts'
import type { TreeDataNode } from 'antd'

import { Alert, Button, Drawer, Modal, Spin, Tag, Tree } from 'antd'
import { useTranslation } from 'react-i18next'

import {
  authorizationDrawerClassNames,
  authorizationDrawerStyles,
  isAuthorizationImpactPending,
} from './authorization-overlay'

interface SelectionOverlay<T> {
  checkedKeys: string[]
  item: T | null
}

interface RoleImpactState {
  assignedUserCount?: number
  isError: boolean
  isFetching: boolean
  isLoading: boolean
  isSuccess: boolean
  retry: () => void
}

interface RoleAssignmentDrawersProps {
  permissionDiff: { added: string[]; removed: string[] }
  permissionDiffOpen: boolean
  permissionTreeData: TreeDataNode[]
  roleImpact: RoleImpactState
  rolePermission: SelectionOverlay<AuthorizationRole>
  rolePermissionPending: boolean
  roleTreeData: TreeDataNode[]
  userRole: SelectionOverlay<AuthorizationUser>
  userRolePending: boolean
  onChangeRolePermissions: (keys: string[]) => void
  onChangeUserRoles: (keys: string[]) => void
  onClosePermissionDiff: () => void
  onCloseRolePermission: () => void
  onCloseUserRole: () => void
  onOpenPermissionDiff: () => void
  onSaveRolePermissions: () => void
  onSaveUserRoles: () => void
}

function toStringKeys(keys: React.Key[]): string[] {
  return keys.filter((key): key is string => typeof key === 'string')
}

export function RoleAssignmentDrawers({
  permissionDiff,
  permissionDiffOpen,
  permissionTreeData,
  roleImpact,
  rolePermission,
  rolePermissionPending,
  roleTreeData,
  userRole,
  userRolePending,
  onChangeRolePermissions,
  onChangeUserRoles,
  onClosePermissionDiff,
  onCloseRolePermission,
  onCloseUserRole,
  onOpenPermissionDiff,
  onSaveRolePermissions,
  onSaveUserRoles,
}: RoleAssignmentDrawersProps) {
  const { t } = useTranslation()
  const hasPermissionChanges = permissionDiff.added.length > 0 || permissionDiff.removed.length > 0
  const roleImpactPending = isAuthorizationImpactPending(roleImpact)

  return (
    <>
      <Drawer
        title={t('authorization.users.editTitle', { name: userRole.item?.name ?? '' })}
        placement="right"
        open={userRole.item !== null}
        size="default"
        classNames={authorizationDrawerClassNames}
        styles={authorizationDrawerStyles}
        onClose={onCloseUserRole}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={onCloseUserRole}>{t('common.cancel')}</Button>
            <Button type="primary" loading={userRolePending} onClick={onSaveUserRoles}>
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
          checkedKeys={userRole.checkedKeys}
          onCheck={(checked) => {
            const keys = Array.isArray(checked) ? checked : checked.checked
            onChangeUserRoles(toStringKeys(keys))
          }}
        />
      </Drawer>

      <Drawer
        title={t('authorization.roles.editTitle', { name: rolePermission.item?.name ?? '' })}
        placement="right"
        open={rolePermission.item !== null}
        size="large"
        classNames={authorizationDrawerClassNames}
        styles={authorizationDrawerStyles}
        onClose={onCloseRolePermission}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={onCloseRolePermission}>{t('common.cancel')}</Button>
            <Button
              type="primary"
              loading={rolePermissionPending}
              disabled={hasPermissionChanges && (!roleImpact.isSuccess || roleImpactPending)}
              onClick={hasPermissionChanges ? onOpenPermissionDiff : onCloseRolePermission}
            >
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <div className="mb-3">
          {roleImpactPending ? (
            <Spin size="small" />
          ) : roleImpact.isError ? (
            <Alert
              type="error"
              showIcon
              message={t('authorization.roles.impactLoadFailed')}
              action={<Button onClick={roleImpact.retry}>{t('common.retry')}</Button>}
            />
          ) : roleImpact.isSuccess ? (
            <Alert
              type="info"
              showIcon
              message={t('authorization.roles.assignedUserCount', { count: roleImpact.assignedUserCount ?? 0 })}
            />
          ) : null}
        </div>
        <div className="mb-3 text-fg-muted text-sm">{t('authorization.roles.permissions')}</div>
        <Tree
          checkable
          defaultExpandAll
          selectable={false}
          treeData={permissionTreeData}
          checkedKeys={rolePermission.checkedKeys}
          onCheck={(checked) => {
            const keys = Array.isArray(checked) ? checked : checked.checked
            onChangeRolePermissions(toStringKeys(keys))
          }}
        />
      </Drawer>

      <Modal
        title={t('authorization.roles.diffTitle', { name: rolePermission.item?.name ?? '' })}
        open={permissionDiffOpen}
        confirmLoading={rolePermissionPending}
        okText={t('common.save')}
        okButtonProps={{ disabled: !roleImpact.isSuccess || roleImpactPending }}
        cancelText={t('common.cancel')}
        onOk={onSaveRolePermissions}
        onCancel={onClosePermissionDiff}
      >
        <div className="space-y-3">
          {roleImpact.isSuccess ? (
            <div className="text-fg text-sm">
              {t('authorization.roles.assignedUserCount', { count: roleImpact.assignedUserCount ?? 0 })}
            </div>
          ) : null}
          {permissionDiff.added.length > 0 ? (
            <div>
              <div className="text-fg-muted mb-1 text-sm">{t('authorization.roles.diffAdded')}</div>
              <div className="flex flex-wrap gap-1">
                {permissionDiff.added.map((key) => (
                  <Tag
                    key={key}
                    color="green"
                    className="m-0 max-w-full break-all"
                    style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}
                  >
                    {key}
                  </Tag>
                ))}
              </div>
            </div>
          ) : null}
          {permissionDiff.removed.length > 0 ? (
            <div>
              <div className="text-fg-muted mb-1 text-sm">{t('authorization.roles.diffRemoved')}</div>
              <div className="flex flex-wrap gap-1">
                {permissionDiff.removed.map((key) => (
                  <Tag
                    key={key}
                    color="red"
                    className="m-0 max-w-full break-all"
                    style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}
                  >
                    {key}
                  </Tag>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  )
}
