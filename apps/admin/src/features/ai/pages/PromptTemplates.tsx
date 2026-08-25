import type { PromptTemplate } from '@starter/contracts'
import type { TableProps } from 'antd'

import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tooltip,
  Typography,
} from 'antd'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useCreatePromptTemplateMutation,
  useDeletePromptTemplateMutation,
  usePromptTemplatesQuery,
  useUpdatePromptTemplateMutation,
} from '@admin/api/ai'
import { AdminPageHeader, PageToolbar } from '@admin/components/common'

const { TextArea } = Input

interface TemplateFormValues {
  name: string
  description?: string
  content: string
  enabled: boolean
  sortOrder: number
}

export function PromptTemplates() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const templatesQuery = usePromptTemplatesQuery()
  const createTemplate = useCreatePromptTemplateMutation()
  const updateTemplate = useUpdatePromptTemplateMutation()
  const deleteTemplate = useDeletePromptTemplateMutation()

  const [editing, setEditing] = useState<PromptTemplate | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm<TemplateFormValues>()

  const templates = templatesQuery.data ?? []

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ enabled: true, sortOrder: 0 })
    setModalOpen(true)
  }

  const openEdit = (template: PromptTemplate) => {
    setEditing(template)
    form.setFieldsValue({
      name: template.name,
      description: template.description,
      content: template.content,
      enabled: template.enabled,
      sortOrder: template.sortOrder,
    })
    setModalOpen(true)
  }

  const submit = async () => {
    const values = await form.validateFields()
    try {
      if (editing) {
        await updateTemplate.mutateAsync({ id: editing.id, values })
        message.success(t('ai.promptTemplates.updateSuccess'))
      } else {
        await createTemplate.mutateAsync(values)
        message.success(t('ai.promptTemplates.createSuccess'))
      }
      setModalOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.promptTemplates.saveFailed'))
    }
  }

  const remove = async (template: PromptTemplate) => {
    try {
      await deleteTemplate.mutateAsync(template.id)
      message.success(t('ai.promptTemplates.deleteSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.promptTemplates.deleteFailed'))
    }
  }

  const columns: TableProps<PromptTemplate>['columns'] = [
    {
      title: t('ai.promptTemplates.sortOrder'),
      dataIndex: 'sortOrder',
      width: 80,
      render: (sortOrder: number) => <Typography.Text type="secondary">{sortOrder}</Typography.Text>,
    },
    {
      title: t('ai.promptTemplates.name'),
      dataIndex: 'name',
      width: 180,
      render: (name: string) => <Typography.Text strong>{name}</Typography.Text>,
    },
    {
      title: t('ai.promptTemplates.description'),
      dataIndex: 'description',
      ellipsis: true,
      render: (description: string) => <Typography.Text type="secondary">{description || '-'}</Typography.Text>,
    },
    {
      title: t('ai.promptTemplates.content'),
      dataIndex: 'content',
      ellipsis: true,
      render: (content: string) => <Typography.Text type="secondary">{content}</Typography.Text>,
    },
    {
      title: t('ai.promptTemplates.enabled'),
      dataIndex: 'enabled',
      width: 90,
      render: (enabled: boolean, record) => (
        <Switch
          checked={enabled}
          checkedChildren={t('ai.promptTemplates.on')}
          unCheckedChildren={t('ai.promptTemplates.off')}
          onChange={(checked) => {
            void updateTemplate.mutateAsync({ id: record.id, values: { enabled: checked } })
          }}
        />
      ),
    },
    {
      title: t('ai.promptTemplates.actions'),
      key: 'actions',
      width: 130,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEdit(record)}>
            {t('ai.promptTemplates.edit')}
          </Button>
          <Popconfirm
            title={t('ai.promptTemplates.deleteConfirm')}
            onConfirm={() => remove(record)}
            okText={t('ai.promptTemplates.confirm')}
            cancelText={t('ai.promptTemplates.cancel')}
          >
            <Tooltip title={t('ai.promptTemplates.delete')}>
              <Button
                size="small"
                danger
                aria-label={t('ai.promptTemplates.delete')}
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
      <div className="space-y-2">
        <AdminPageHeader title={t('menu.aiPromptTemplates')} description={t('ai.promptTemplates.pageDescription')} />
        <PageToolbar
          actions={
            <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
              {t('ai.promptTemplates.create')}
            </Button>
          }
        />
      </div>
      <section className="flex min-h-0 flex-1 flex-col">
        <Table<PromptTemplate>
          rowKey="id"
          className="guide-table-fill min-h-64"
          columns={columns}
          dataSource={templates}
          loading={templatesQuery.isLoading}
          pagination={false}
          scroll={{ x: 800, y: '100%' }}
        />
      </section>
      <Modal
        title={editing ? t('ai.promptTemplates.edit') : t('ai.promptTemplates.create')}
        open={modalOpen}
        onOk={submit}
        confirmLoading={createTemplate.isPending || updateTemplate.isPending}
        onCancel={() => setModalOpen(false)}
        okText={t('ai.promptTemplates.save')}
        cancelText={t('ai.promptTemplates.cancel')}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ enabled: true, sortOrder: 0 }}>
          <Form.Item
            name="name"
            label={t('ai.promptTemplates.name')}
            rules={[{ required: true, message: t('ai.promptTemplates.nameRequired') }]}
          >
            <Input placeholder="review-code" disabled={Boolean(editing)} />
          </Form.Item>
          <Form.Item name="description" label={t('ai.promptTemplates.description')}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item
            name="content"
            label={t('ai.promptTemplates.content')}
            rules={[{ required: true, message: t('ai.promptTemplates.contentRequired') }]}
          >
            <TextArea rows={5} maxLength={8000} showCount />
          </Form.Item>
          <Form.Item name="sortOrder" label={t('ai.promptTemplates.sortOrder')}>
            <InputNumber min={0} max={10000} className="w-full" />
          </Form.Item>
          <Form.Item name="enabled" label={t('ai.promptTemplates.enabled')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
