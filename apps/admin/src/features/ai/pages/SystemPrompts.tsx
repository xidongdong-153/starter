import type { SystemPrompt } from '@starter/contracts'
import type { TableProps } from 'antd'

import { App, Button, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd'
import { Globe, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useCreateSystemPromptMutation,
  useDeleteSystemPromptMutation,
  useGlobalSystemPromptQuery,
  useSetGlobalSystemPromptMutation,
  useSystemPromptsQuery,
  useUpdateSystemPromptMutation,
} from '@admin/api/ai'
import { AdminPageHeader } from '@admin/components/common'

const { TextArea } = Input

interface PromptFormValues {
  name: string
  content: string
  enabled: boolean
}

export function SystemPrompts() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const promptsQuery = useSystemPromptsQuery()
  const globalQuery = useGlobalSystemPromptQuery()
  const createPrompt = useCreateSystemPromptMutation()
  const updatePrompt = useUpdateSystemPromptMutation()
  const deletePrompt = useDeleteSystemPromptMutation()
  const setGlobal = useSetGlobalSystemPromptMutation()

  const [editing, setEditing] = useState<SystemPrompt | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm<PromptFormValues>()

  const prompts = promptsQuery.data ?? []
  const globalPromptId = globalQuery.data?.systemPromptId ?? null

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ enabled: true })
    setModalOpen(true)
  }

  const openEdit = (prompt: SystemPrompt) => {
    setEditing(prompt)
    form.setFieldsValue({
      name: prompt.name,
      content: prompt.content,
      enabled: prompt.enabled,
    })
    setModalOpen(true)
  }

  const submit = async () => {
    const values = await form.validateFields()
    try {
      if (editing) {
        await updatePrompt.mutateAsync({ id: editing.id, values })
        message.success(t('ai.systemPrompts.updateSuccess'))
      } else {
        await createPrompt.mutateAsync(values)
        message.success(t('ai.systemPrompts.createSuccess'))
      }
      setModalOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('common.saveFailed'))
    }
  }

  const remove = async (prompt: SystemPrompt) => {
    try {
      await deletePrompt.mutateAsync(prompt.id)
      message.success(t('ai.systemPrompts.deleteSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('common.deleteFailed'))
    }
  }

  const makeGlobal = async (prompt: SystemPrompt) => {
    try {
      await setGlobal.mutateAsync(prompt.id)
      message.success(t('ai.systemPrompts.setGlobalSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('common.saveFailed'))
    }
  }

  const columns: TableProps<SystemPrompt>['columns'] = [
    {
      title: t('ai.systemPrompts.name'),
      dataIndex: 'name',
      width: 240,
      render: (name: string, record) => (
        <div className="flex min-w-0 items-center gap-2">
          <Typography.Text strong className="truncate">
            {name}
          </Typography.Text>
          {record.id === globalPromptId ? (
            <Tag color="blue" className="m-0 inline-flex shrink-0 items-center gap-1 text-xs">
              <Globe className="size-3" />
              {t('ai.systemPrompts.globalDefault')}
            </Tag>
          ) : null}
        </div>
      ),
    },
    {
      title: t('ai.systemPrompts.content'),
      dataIndex: 'content',
      ellipsis: true,
      render: (content: string) => <Typography.Text type="secondary">{content}</Typography.Text>,
    },
    {
      title: t('ai.systemPrompts.enabled'),
      dataIndex: 'enabled',
      width: 96,
      render: (enabled: boolean, record) => (
        <Switch
          checked={enabled}
          checkedChildren={t('common.on')}
          unCheckedChildren={t('common.off')}
          onChange={(checked) => {
            void updatePrompt.mutateAsync({ id: record.id, values: { enabled: checked } })
          }}
        />
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      fixed: 'right',
      width: 132,
      render: (_, record) => (
        <Space size="small">
          {record.id === globalPromptId ? null : (
            <Tooltip title={t('ai.systemPrompts.setGlobal')}>
              <Button
                size="small"
                aria-label={t('ai.systemPrompts.setGlobal')}
                icon={<Globe className="size-3.5" />}
                onClick={() => makeGlobal(record)}
              />
            </Tooltip>
          )}
          <Tooltip title={t('common.edit')}>
            <Button
              size="small"
              aria-label={t('common.edit')}
              icon={<Pencil className="size-3.5" />}
              onClick={() => openEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title={t('ai.systemPrompts.deleteConfirm')}
            onConfirm={() => remove(record)}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
          >
            <Tooltip title={t('ai.systemPrompts.delete')}>
              <Button
                size="small"
                danger
                aria-label={t('ai.systemPrompts.delete')}
                icon={<Trash2 className="size-3.5" />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <AdminPageHeader
        title={t('menu.aiSystemPrompts')}
        description={t('ai.systemPrompts.description')}
        actions={
          <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
            {t('ai.systemPrompts.create')}
          </Button>
        }
      />
      <section className="flex min-h-0 flex-1 flex-col">
        <Table<SystemPrompt>
          rowKey="id"
          className="guide-table-fill min-h-64"
          columns={columns}
          dataSource={prompts}
          loading={promptsQuery.isLoading}
          pagination={false}
          scroll={{ x: 900, y: '100%' }}
        />
      </section>
      <Modal
        title={editing ? t('ai.systemPrompts.edit') : t('ai.systemPrompts.create')}
        open={modalOpen}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ enabled: true }}>
          <Form.Item
            name="name"
            label={t('ai.systemPrompts.name')}
            rules={[{ required: true, message: t('ai.systemPrompts.nameRequired') }]}
          >
            <Input placeholder="code-reviewer" disabled={Boolean(editing)} />
          </Form.Item>
          <Form.Item
            name="content"
            label={t('ai.systemPrompts.content')}
            rules={[{ required: true, message: t('ai.systemPrompts.contentRequired') }]}
          >
            <TextArea rows={6} placeholder={t('ai.systemPrompts.contentPlaceholder')} maxLength={8000} showCount />
          </Form.Item>
          <Form.Item name="enabled" label={t('ai.systemPrompts.enabled')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
