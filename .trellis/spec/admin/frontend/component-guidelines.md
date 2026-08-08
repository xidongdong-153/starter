# Admin 组件规范

## 页面组件

页面组件负责组合查询、表单、反馈和布局；请求细节放在 `api/<domain>`。`features/files/pages/FileList.tsx` 使用 `useFilesQuery` 和三个 mutation，再把结果交给 `Table`、`Modal` 和 `Upload`。

```tsx
const filesQuery = useFilesQuery();
const uploadMutation = useUploadFileMutation();
const files = filesQuery.data ?? [];

{
  filesQuery.error ? (
    <Alert
      action={<Button onClick={() => void filesQuery.refetch()}>重试</Button>}
      type="error"
    />
  ) : null;
}
```

页面必须处理查询中的加载、错误和空数据。mutation 的 pending 状态传给按钮或对话框，例如 `loading={uploadMutation.isPending}` 和 `confirmLoading={renameMutation.isPending}`。

## 共享组件

跨 feature 的页面标题和错误状态放入 `components/common/` 或 `components/ui/`。`AdminPageHeader` 通过 `summaryItems` 和 `actions` 组合页面信息；`ErrorBoundary` 统一提供重试和返回首页操作。

## 表单与交互

- Ant Design 表单使用 `Form.useForm<FormValues>()` 明确表单值类型，提交入口使用 `onFinish`。
- 接口 DTO 与表单值分开；`ProfileSettings.tsx` 通过 `toFormValues` 和 `toUpdateInput` 转换空字符串、换行文本和 `null`。
- 图标按钮使用 `lucide-react`，同时设置 `aria-label` 或 `Tooltip`。文件操作可参考 `FileList.tsx`。
- 删除等不可逆动作使用 `App.useApp().modal.confirm`，成功后用 `message.success`，失败时显示 `Error` 消息。
- 页面文案通过 `useTranslation` 和 `src/i18n/locales/{zh,en}.ts` 提供，不在领域组件里重复维护中英文分支。

## 不要做的事

不要在组件中直接调用 `fetch`、手动管理 React Query cache，或用 `any` 绕过表格/表单类型。请求应由 `apiRequest` 和对应 query hook 统一处理。
