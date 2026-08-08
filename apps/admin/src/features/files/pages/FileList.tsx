import type { FileItem } from '@starter/contracts'
import type { TableProps } from 'antd'

import {
  downloadFileBlob,
  useDeleteFileMutation,
  useFilesQuery,
  useRenameFileMutation,
  useUploadFileMutation,
} from '@admin/api/files'
import { resolveApiUrl } from '@admin/api/client'
import { AdminPageHeader } from '@admin/components/common'
import { formatDate } from '@admin/utils/dayjs'
import { formatFileSize } from '@admin/utils/format'
import { Alert, App, Button, Form, Input, Modal, Table, Tooltip, Upload } from 'antd'
import { Download, Eye, Pencil, Trash2, UploadCloud } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface RenameFormValues {
  name: string
}

export function FileList() {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const [form] = Form.useForm<RenameFormValues>()
  const [keyword, setKeyword] = useState('')
  const [renamingFile, setRenamingFile] = useState<FileItem | null>(null)
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)

  const filesQuery = useFilesQuery()
  const uploadMutation = useUploadFileMutation()
  const renameMutation = useRenameFileMutation()
  const deleteMutation = useDeleteFileMutation()

  const files = filesQuery.data ?? []
  const filteredFiles = useMemo(() => {
    const trimmedKeyword = keyword.trim().toLowerCase()

    if (!trimmedKeyword) {
      return files
    }

    return files.filter(
      (file) =>
        file.name.toLowerCase().includes(trimmedKeyword) || file.mimeType.toLowerCase().includes(trimmedKeyword),
    )
  }, [files, keyword])

  const handleUpload = async (file: File) => {
    try {
      await uploadMutation.mutateAsync(file)
      message.success(t('files.uploadSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('files.uploadFailed'))
    }

    return false
  }

  const handleDownload = async (file: FileItem) => {
    try {
      const blob = await downloadFileBlob(file)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')

      link.href = url
      link.download = file.name
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('files.downloadFailed'))
    }
  }

  const openRenameModal = (file: FileItem) => {
    setRenamingFile(file)
    form.setFieldsValue({ name: file.name })
  }

  const handleRename = async (values: RenameFormValues) => {
    if (!renamingFile) {
      return
    }

    try {
      await renameMutation.mutateAsync({ fileId: renamingFile.id, name: values.name })
      message.success(t('files.renameSuccess'))
      setRenamingFile(null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('files.renameTitle'))
    }
  }

  const confirmDelete = (file: FileItem) => {
    modal.confirm({
      title: t('files.deleteConfirmTitle'),
      content: t('files.deleteConfirmMessage', { name: file.name }),
      okButtonProps: { danger: true },
      okText: t('files.delete'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        await deleteMutation.mutateAsync(file.id)
        message.success(t('files.deleteSuccess'))
      },
    })
  }

  const columns: TableProps<FileItem>['columns'] = [
    {
      dataIndex: 'name',
      key: 'name',
      title: t('files.table.name'),
      render: (name: string, file: FileItem) => (
        <div className="flex items-center gap-3">
          {file.mimeType.startsWith('image/') ? (
            <button
              type="button"
              title={name}
              className="border-border-subtle size-10 shrink-0 cursor-pointer overflow-hidden rounded border"
              onClick={() => setPreviewFile(file)}
            >
              <img
                src={resolveApiUrl(file.contentUrl)}
                alt=""
                crossOrigin="use-credentials"
                className="block size-full object-cover"
              />
            </button>
          ) : null}
          <span className="text-fg font-medium">{name}</span>
        </div>
      ),
    },
    {
      dataIndex: 'mimeType',
      key: 'mimeType',
      title: t('files.table.mimeType'),
      render: (mimeType: string) => <span className="text-fg-muted text-sm">{mimeType}</span>,
    },
    {
      align: 'right',
      dataIndex: 'size',
      key: 'size',
      sorter: (a, b) => a.size - b.size,
      title: t('files.table.size'),
      render: (size: number) => <span className="tabular-nums">{formatFileSize(size)}</span>,
    },
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      sorter: (a, b) => a.createdAt.localeCompare(b.createdAt),
      title: t('files.table.createdAt'),
      render: (createdAt: string) => <span className="tabular-nums">{formatDate(createdAt)}</span>,
    },
    {
      key: 'actions',
      title: t('files.table.actions'),
      render: (_, file) => (
        <div className="flex gap-2">
          {file.mimeType.startsWith('image/') ? (
            <Tooltip title={t('files.preview')}>
              <Button
                size="small"
                aria-label={t('files.preview')}
                icon={<Eye className="size-4" />}
                onClick={() => setPreviewFile(file)}
              />
            </Tooltip>
          ) : null}
          <Tooltip title={t('files.download')}>
            <Button
              size="small"
              aria-label={t('files.download')}
              icon={<Download className="size-4" />}
              onClick={() => void handleDownload(file)}
            />
          </Tooltip>
          <Tooltip title={t('files.rename')}>
            <Button
              size="small"
              aria-label={t('files.rename')}
              icon={<Pencil className="size-4" />}
              onClick={() => openRenameModal(file)}
            />
          </Tooltip>
          <Tooltip title={t('files.delete')}>
            <Button
              size="small"
              danger
              aria-label={t('files.delete')}
              icon={<Trash2 className="size-4" />}
              onClick={() => confirmDelete(file)}
            />
          </Tooltip>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t('files.title')}
        description={t('files.description')}
        summaryItems={[
          { label: t('files.summary.total'), value: files.length },
          { label: t('files.summary.currentResults'), value: filteredFiles.length },
        ]}
        actions={
          <Upload accept="*/*" beforeUpload={handleUpload} maxCount={1} showUploadList={false}>
            <Button type="primary" icon={<UploadCloud className="size-4" />} loading={uploadMutation.isPending}>
              {t('files.upload')}
            </Button>
          </Upload>
        }
      />

      {filesQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={t('files.loadFailed')}
          description={filesQuery.error instanceof Error ? filesQuery.error.message : undefined}
          action={<Button onClick={() => void filesQuery.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}

      <section className="space-y-4">
        <Input.Search
          allowClear
          placeholder={t('files.searchPlaceholder')}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          className="max-w-md"
        />

        <Table<FileItem>
          rowKey="id"
          columns={columns}
          dataSource={filteredFiles}
          loading={filesQuery.isLoading}
          locale={{ emptyText: t('files.emptyText') }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          scroll={{ x: 'max-content' }}
        />
      </section>

      <Modal
        title={previewFile?.name}
        open={Boolean(previewFile)}
        onCancel={() => setPreviewFile(null)}
        footer={null}
        destroyOnHidden
      >
        {previewFile ? (
          <img
            src={resolveApiUrl(previewFile.contentUrl)}
            alt={previewFile.name}
            crossOrigin="use-credentials"
            className="block w-full rounded"
          />
        ) : null}
      </Modal>

      <Modal
        title={t('files.renameTitle')}
        open={Boolean(renamingFile)}
        onCancel={() => setRenamingFile(null)}
        onOk={() => void form.submit()}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={renameMutation.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleRename}>
          <Form.Item
            name="name"
            label={t('files.table.name')}
            rules={[{ message: t('files.renameRequired'), required: true }]}
          >
            <Input placeholder={t('files.renamePlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
