import type {
  AuthorizationPermission,
  AuthorizationRole,
  CreateRoleInput,
  Permission,
  UpdateRoleInput,
} from '@starter/contracts'
import type { TreeDataNode } from 'antd'

import { roleKeySchema } from '@starter/contracts'

import { resolveRoleKeySuggestion } from '@admin/features/authorization/role-key'

import { Button, Drawer, Form, Input, Tree } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { authorizationDrawerClassNames, authorizationDrawerStyles } from './authorization-overlay'

interface CreateRoleFormValues {
  name: string
  key: string
  description?: string
}

interface RoleMetadataFormValues {
  name: string
  description?: string
}

interface RoleFormDrawersProps {
  createOpen: boolean
  createPending: boolean
  metadataRole: AuthorizationRole | null
  permissionTreeData: TreeDataNode[]
  permissions: AuthorizationPermission[]
  updatePending: boolean
  onCloseCreate: () => void
  onCloseMetadata: () => void
  onCreate: (input: CreateRoleInput) => Promise<boolean>
  onUpdate: (roleKey: string, input: UpdateRoleInput) => Promise<boolean>
}

function toStringKeys(keys: React.Key[]): string[] {
  return keys.filter((key): key is string => typeof key === 'string')
}

export function RoleFormDrawers({
  createOpen,
  createPending,
  metadataRole,
  permissionTreeData,
  permissions,
  updatePending,
  onCloseCreate,
  onCloseMetadata,
  onCreate,
  onUpdate,
}: RoleFormDrawersProps) {
  const { t } = useTranslation()
  const [createForm] = Form.useForm<CreateRoleFormValues>()
  const [metadataForm] = Form.useForm<RoleMetadataFormValues>()
  const [createCheckedKeys, setCreateCheckedKeys] = useState<string[]>([])
  const [keyTouched, setKeyTouched] = useState(false)
  const permissionByKey = useMemo(
    () => new Map<string, Permission>(permissions.map((permission) => [permission.key, permission.key])),
    [permissions],
  )

  const resetCreateForm = () => {
    createForm.resetFields()
    setCreateCheckedKeys([])
    setKeyTouched(false)
  }

  const closeCreateDrawer = () => {
    resetCreateForm()
    onCloseCreate()
  }

  const submitCreateRole = async (values: CreateRoleFormValues) => {
    const permissionKeys = createCheckedKeys
      .map((key) => permissionByKey.get(key))
      .filter((permission): permission is Permission => permission !== undefined)
    const created = await onCreate({
      key: values.key,
      name: values.name,
      description: values.description?.trim() ? values.description.trim() : null,
      permissionKeys,
    })
    if (created) closeCreateDrawer()
  }

  const submitMetadata = async (values: RoleMetadataFormValues) => {
    if (!metadataRole) return
    const updated = await onUpdate(metadataRole.key, {
      name: values.name,
      description: values.description?.trim() ? values.description.trim() : null,
    })
    if (updated) onCloseMetadata()
  }

  return (
    <>
      <Drawer
        title={t('authorization.roles.createTitle')}
        placement="right"
        open={createOpen}
        size="large"
        classNames={authorizationDrawerClassNames}
        styles={authorizationDrawerStyles}
        afterOpenChange={(open) => {
          if (open) resetCreateForm()
        }}
        onClose={closeCreateDrawer}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={closeCreateDrawer}>{t('common.cancel')}</Button>
            <Button type="primary" loading={createPending} onClick={() => createForm.submit()}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <Form<CreateRoleFormValues>
          form={createForm}
          layout="vertical"
          onFinish={(values) => void submitCreateRole(values)}
          onValuesChange={(changedValues: Partial<CreateRoleFormValues>) => {
            if (changedValues.key !== undefined) {
              setKeyTouched(true)
              return
            }
            if (changedValues.name !== undefined) {
              const suggestion = resolveRoleKeySuggestion(changedValues.name, keyTouched)
              if (suggestion !== null) createForm.setFieldsValue({ key: suggestion })
            }
          }}
        >
          <Form.Item
            name="name"
            label={t('authorization.roles.nameLabel')}
            rules={[{ required: true, max: 80, whitespace: true }]}
          >
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item
            name="key"
            label={t('authorization.roles.keyLabel')}
            extra={t('authorization.roles.keyHelp')}
            rules={[
              { required: true },
              {
                validator: (_, value: string) =>
                  !value || roleKeySchema.safeParse(value).success
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('authorization.roles.keyInvalid'))),
              },
            ]}
          >
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item name="description" label={t('authorization.roles.descriptionLabel')} rules={[{ max: 500 }]}>
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
          <div className="mb-3 text-fg-muted text-sm">{t('authorization.roles.permissions')}</div>
          <Tree
            checkable
            defaultExpandAll
            selectable={false}
            treeData={permissionTreeData}
            checkedKeys={createCheckedKeys}
            onCheck={(checked) => {
              const keys = Array.isArray(checked) ? checked : checked.checked
              setCreateCheckedKeys(toStringKeys(keys))
            }}
          />
        </Form>
      </Drawer>

      <Drawer
        title={t('authorization.roles.metadataTitle', { name: metadataRole?.name ?? '' })}
        placement="right"
        open={metadataRole !== null}
        size="default"
        classNames={authorizationDrawerClassNames}
        styles={authorizationDrawerStyles}
        afterOpenChange={(open) => {
          if (open && metadataRole) {
            metadataForm.setFieldsValue({ name: metadataRole.name, description: metadataRole.description ?? '' })
          }
        }}
        onClose={onCloseMetadata}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={onCloseMetadata}>{t('common.cancel')}</Button>
            <Button type="primary" loading={updatePending} onClick={() => metadataForm.submit()}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <Form<RoleMetadataFormValues>
          form={metadataForm}
          layout="vertical"
          onFinish={(values) => void submitMetadata(values)}
        >
          <Form.Item
            name="name"
            label={t('authorization.roles.nameLabel')}
            rules={[{ required: true, max: 80, whitespace: true }]}
          >
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item name="description" label={t('authorization.roles.descriptionLabel')} rules={[{ max: 500 }]}>
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  )
}
