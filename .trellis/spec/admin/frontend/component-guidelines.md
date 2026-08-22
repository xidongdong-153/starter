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
- 用 `Modal` 的 `onOk` 提交时，`form.validateFields()` 必须自己 catch：校验失败会返回 rejected promise，Antd 不接，在 Vitest 里会变成 unhandled rejection 直接把整轮测试弄成失败。写法参考 `features/ai/pages/AiApplications.tsx` 的 `submitCreate`：先 `try { values = await form.validateFields() } catch { return }`，再跑 mutation。
- 接口 DTO 与表单值分开；`ProfileSettings.tsx` 通过 `toFormValues` 和 `toUpdateInput` 转换空字符串、换行文本和 `null`。
- 图标按钮使用 `lucide-react`，同时设置 `aria-label` 或 `Tooltip`。文件操作可参考 `FileList.tsx`。
- 删除等不可逆动作使用 `App.useApp().modal.confirm`，成功后用 `message.success`，失败时显示 `Error` 消息。
- 页面文案通过 `useTranslation` 和 `src/i18n/locales/{zh,en}.ts` 提供，不在领域组件里重复维护中英文分支。
- 表单字段对应 contracts 里已有 schema 时，用 `schema.safeParse(value)` 做 `validator` 而不是手抄正则，参考 `AiApplications.tsx` 的 `aiScopeIdSchema` 和 `RoleFormDrawers.tsx` 的 `roleKeySchema`。
- 页面同时存在侧边栏/局部搜索框与主文本域时，搜索框显式指定 `role="searchbox"`，确保无障碍语义与测试定位隔离。

## 一次性凭据展示

创建或轮换应用凭据这类只返回一次的 secret，按 `features/ai/pages/AiApplications.tsx` 的做法：

- secret 只放组件 `useState`，用独立弹窗展示，弹窗关闭时清空 state 并调用 mutation 的 `reset()`，避免值留在 React Query 的 MutationCache。
- 不写入 query cache、URL、localStorage 和 `console`；列表接口只显示 `secretPrefix`。
- 弹窗要写清关闭后无法再查看，并标明是哪个应用的 secret。
- 复制按钮失败时给出可执行提示（手动选中复制），不吞掉错误。

## 不要做的事

不要在组件中直接调用 `fetch`、手动管理 React Query cache，或用 `any` 绕过表格/表单类型。请求应由 `apiRequest` 和对应 query hook 统一处理。
