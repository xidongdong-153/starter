import type { Permission } from '@starter/contracts'

import { PermissionKeys } from '@starter/contracts'

import { PermissionGuard } from '@admin/components/common'

import { Alert, Button, Drawer, Empty, Modal, Spin, Tag } from 'antd'
import { useTranslation } from 'react-i18next'

import {
  authorizationDrawerClassNames,
  authorizationDrawerStyles,
  isAuthorizationImpactPending,
} from './authorization-overlay'

interface RoleImpactState {
  assignedUserCount?: number
  isError: boolean
  isFetching: boolean
  isLoading: boolean
  retry: () => void
}

interface PermissionImpactState {
  affectedUserCount?: number
  isError: boolean
  isLoading: boolean
  retry: () => void
  roleKeys?: string[]
}

interface RoleLifecycleOverlaysProps {
  archiveImpact: RoleImpactState
  archivePending: boolean
  archiveRoleKey: string | null
  permissionImpact: PermissionImpactState
  permissionImpactKey: Permission | null
  restorePending: boolean
  restoreRoleName: string | null
  roleImpact: RoleImpactState
  roleImpactKey: string | null
  onArchive: () => void
  onCloseArchive: () => void
  onClosePermissionImpact: () => void
  onCloseRestore: () => void
  onCloseRoleImpact: () => void
  onRestore: () => void
}

export function RoleLifecycleOverlays({
  archiveImpact,
  archivePending,
  archiveRoleKey,
  permissionImpact,
  permissionImpactKey,
  restorePending,
  restoreRoleName,
  roleImpact,
  roleImpactKey,
  onArchive,
  onCloseArchive,
  onClosePermissionImpact,
  onCloseRestore,
  onCloseRoleImpact,
  onRestore,
}: RoleLifecycleOverlaysProps) {
  const { t } = useTranslation()
  const archiveAssignedCount = archiveImpact.assignedUserCount
  const archiveImpactPending = isAuthorizationImpactPending(archiveImpact)
  const roleImpactPending = isAuthorizationImpactPending(roleImpact)

  return (
    <>
      <Drawer
        title={t('authorization.roles.impactTitle', { name: roleImpactKey ?? '' })}
        placement="right"
        open={roleImpactKey !== null}
        size="default"
        classNames={authorizationDrawerClassNames}
        styles={authorizationDrawerStyles}
        onClose={onCloseRoleImpact}
      >
        {roleImpactPending ? (
          <Spin />
        ) : roleImpact.isError ? (
          <Alert
            showIcon
            type="error"
            message={t('authorization.roles.impactLoadFailed')}
            action={<Button onClick={roleImpact.retry}>{t('common.retry')}</Button>}
          />
        ) : roleImpact.assignedUserCount !== undefined ? (
          <div className="text-fg">
            {t('authorization.roles.assignedUserCount', { count: roleImpact.assignedUserCount })}
          </div>
        ) : null}
      </Drawer>

      <PermissionGuard permission={PermissionKeys.AUTHORIZATION_MANAGE}>
        <Modal
          title={t('authorization.roles.archiveTitle', { name: archiveRoleKey ?? '' })}
          open={archiveRoleKey !== null}
          confirmLoading={archivePending}
          okText={t('authorization.roles.archive')}
          okButtonProps={{
            danger: true,
            disabled: archiveImpactPending || archiveImpact.isError || (archiveAssignedCount ?? 1) > 0,
          }}
          cancelText={t('common.cancel')}
          onOk={onArchive}
          onCancel={onCloseArchive}
        >
          {archiveImpactPending ? (
            <Spin size="small" />
          ) : archiveImpact.isError ? (
            <Alert
              showIcon
              type="error"
              message={t('authorization.roles.impactLoadFailed')}
              action={<Button onClick={archiveImpact.retry}>{t('common.retry')}</Button>}
            />
          ) : archiveAssignedCount !== undefined && archiveAssignedCount > 0 ? (
            <Alert
              showIcon
              type="warning"
              message={t('authorization.roles.archiveBlocked', { count: archiveAssignedCount })}
            />
          ) : (
            <div className="text-fg">{t('authorization.roles.archiveConfirm')}</div>
          )}
        </Modal>
      </PermissionGuard>

      <PermissionGuard permission={PermissionKeys.AUTHORIZATION_MANAGE}>
        <Modal
          title={t('authorization.roles.restoreTitle', { name: restoreRoleName ?? '' })}
          open={restoreRoleName !== null}
          confirmLoading={restorePending}
          okText={t('authorization.roles.restore')}
          cancelText={t('common.cancel')}
          onOk={onRestore}
          onCancel={onCloseRestore}
        >
          <div className="text-fg">{t('authorization.roles.restoreConfirm')}</div>
        </Modal>
      </PermissionGuard>

      <Drawer
        title={t('authorization.permissionsTab.impactTitle', { key: permissionImpactKey ?? '' })}
        placement="right"
        open={permissionImpactKey !== null}
        size="default"
        classNames={authorizationDrawerClassNames}
        styles={authorizationDrawerStyles}
        onClose={onClosePermissionImpact}
      >
        {permissionImpact.isLoading ? (
          <Spin />
        ) : permissionImpact.isError ? (
          <Alert
            showIcon
            type="error"
            message={t('authorization.permissionsTab.impactLoadFailed')}
            action={<Button onClick={permissionImpact.retry}>{t('common.retry')}</Button>}
          />
        ) : permissionImpact.roleKeys ? (
          <div className="space-y-4">
            <div>
              <div className="text-fg-muted mb-2 text-sm">{t('authorization.permissionsTab.effectiveRoles')}</div>
              {permissionImpact.roleKeys.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {permissionImpact.roleKeys.map((roleKey) => (
                    <Tag
                      key={roleKey}
                      className="m-0 max-w-full break-all"
                      style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}
                    >
                      {roleKey}
                    </Tag>
                  ))}
                </div>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('authorization.permissionsTab.noEffectiveRoles')}
                />
              )}
            </div>
            <div className="text-fg">
              {t('authorization.permissionsTab.affectedUserCount', {
                count: permissionImpact.affectedUserCount ?? 0,
              })}
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  )
}
