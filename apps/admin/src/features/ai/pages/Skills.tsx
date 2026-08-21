import type { AiSkillSummary } from '@starter/contracts'
import type { TableProps } from 'antd'

import { App, Button, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tooltip, Typography } from 'antd'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useAiSkillDetailQuery,
  useCreateAiSkillMutation,
  useDeleteAiSkillMutation,
  useSkillsQuery,
  useUpdateAiSkillMutation,
} from '@admin/api/ai'
import { AdminPageHeader } from '@admin/components/common'

const { TextArea } = Input

interface SkillFormValues {
  name: string
  description: string
  content: string
  enabled: boolean
}

export function Skills() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const skillsQuery = useSkillsQuery()
  const createSkill = useCreateAiSkillMutation()
  const updateSkill = useUpdateAiSkillMutation()
  const deleteSkill = useDeleteAiSkillMutation()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm<SkillFormValues>()
  const detailQuery = useAiSkillDetailQuery(editingId)

  const skills = skillsQuery.data ?? []

  useEffect(() => {
    if (modalOpen && editingId && detailQuery.data) {
      form.setFieldsValue({
        name: detailQuery.data.name,
        description: detailQuery.data.description,
        content: detailQuery.data.content,
        enabled: detailQuery.data.enabled,
      })
    }
  }, [modalOpen, editingId, detailQuery.data, form])

  const openCreate = () => {
    setEditingId(null)
    form.resetFields()
    form.setFieldsValue({ enabled: true })
    setModalOpen(true)
  }

  const openEdit = (skill: AiSkillSummary) => {
    setEditingId(skill.id)
    form.setFieldsValue({
      name: skill.name,
      description: skill.description,
      content: '',
      enabled: skill.enabled,
    })
    setModalOpen(true)
  }

  const submit = async () => {
    const values = await form.validateFields()
    try {
      if (editingId) {
        await updateSkill.mutateAsync({ id: editingId, values })
        message.success(t('ai.skills.updateSuccess'))
      } else {
        await createSkill.mutateAsync(values)
        message.success(t('ai.skills.createSuccess'))
      }
      setModalOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.skills.saveFailed'))
    }
  }

  const remove = async (skill: AiSkillSummary) => {
    try {
      await deleteSkill.mutateAsync(skill.id)
      message.success(t('ai.skills.deleteSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.skills.deleteFailed'))
    }
  }

  const columns: TableProps<AiSkillSummary>['columns'] = [
    {
      title: t('ai.skills.name'),
      dataIndex: 'name',
      render: (name: string) => <Typography.Text strong>{name}</Typography.Text>,
    },
    {
      title: t('ai.skills.descriptionLabel'),
      dataIndex: 'description',
      ellipsis: true,
      render: (description: string) => <Typography.Text type="secondary">{description}</Typography.Text>,
    },
    {
      title: t('ai.skills.enabled'),
      dataIndex: 'enabled',
      width: 80,
      render: (enabled: boolean, record) => (
        <Switch
          checked={enabled}
          checkedChildren={t('ai.skills.on')}
          unCheckedChildren={t('ai.skills.off')}
          onChange={(checked) => {
            void updateSkill.mutateAsync({ id: record.id, values: { enabled: checked } })
          }}
        />
      ),
    },
    {
      title: t('ai.skills.actions'),
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Space size="small">
          <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEdit(record)}>
            {t('ai.skills.edit')}
          </Button>
          <Popconfirm
            title={t('ai.skills.deleteConfirm')}
            onConfirm={() => remove(record)}
            okText={t('ai.skills.confirm')}
            cancelText={t('ai.skills.cancel')}
          >
            <Tooltip title={t('ai.skills.delete')}>
              <Button size="small" danger aria-label={t('ai.skills.delete')} icon={<Trash2 className="size-3.5" />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <AdminPageHeader
        title={t('menu.aiSkills')}
        description={t('ai.skills.description')}
        actions={
          <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
            {t('ai.skills.create')}
          </Button>
        }
      />
      <section className="flex min-h-0 flex-1 flex-col">
        <Table<AiSkillSummary>
          rowKey="id"
          className="guide-table-fill min-h-64"
          columns={columns}
          dataSource={skills}
          loading={skillsQuery.isLoading}
          pagination={false}
          scroll={{ y: '100%' }}
        />
      </section>
      <Modal
        title={editingId ? t('ai.skills.edit') : t('ai.skills.create')}
        open={modalOpen}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        okText={t('ai.skills.save')}
        cancelText={t('ai.skills.cancel')}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ enabled: true }}>
          <Form.Item
            name="name"
            label={t('ai.skills.name')}
            rules={[{ required: true, message: t('ai.skills.nameRequired') }]}
          >
            <Input placeholder="sql-expert" disabled={Boolean(editingId)} />
          </Form.Item>
          <Form.Item
            name="description"
            label={t('ai.skills.descriptionLabel')}
            rules={[{ required: true, message: t('ai.skills.descriptionRequired') }]}
          >
            <Input maxLength={1024} showCount />
          </Form.Item>
          <Form.Item
            name="content"
            label={t('ai.skills.content')}
            rules={[{ required: true, message: t('ai.skills.contentRequired') }]}
          >
            <TextArea rows={8} maxLength={32000} showCount placeholder={t('ai.skills.contentPlaceholder')} />
          </Form.Item>
          <Form.Item name="enabled" label={t('ai.skills.enabled')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
