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

跨 feature 的页面标题、工具栏和错误状态放入 `components/common/` 或 `components/ui/`。

- `AdminPageHeader` 渲染无卡片的单行页头，props 只有 `title`、`description?`、`onBack?`、`backLabel?`；描述与标题同行（`text-sm` 小字、过长截断）。
- `PageToolbar` 渲染表格上方的统一工具栏，props 为 `filters?`、`summaryItems?`、`actions?`；三个都为空时返回 `null`。布局约定：筛选控件和摘要标签在左侧，操作按钮在右侧。
- 页面级操作按钮（新建、上传、刷新）和筛选控件（搜索、下拉、清除）一律放进 `PageToolbar`，不再传给 `AdminPageHeader`；没有工具栏内容的页面只渲染页头。
- `ErrorBoundary` 统一提供重试和返回首页操作。

> **Warning**: antd 的 `Input` 放进 flex 容器会被 antd 的无层级 CSS 撑成 `width: 100%`，把工具栏挤成多行。`Input.Search` 或 `Select` 放进 `PageToolbar` 的 `filters` 时用固定宽度（如 `style={{ width: 256 }}`），参考 `FileList.tsx` 和 `UserManagement.tsx`。

## 表单与交互

- Ant Design 表单使用 `Form.useForm<FormValues>()` 明确表单值类型，提交入口使用 `onFinish`。
- 用 `Modal` 的 `onOk` 提交时，`form.validateFields()` 必须自己 catch：校验失败会返回 rejected promise，Antd 不接，在 Vitest 里会变成 unhandled rejection 直接把整轮测试弄成失败。写法参考 `features/ai/pages/AiApplications.tsx` 的 `submitCreate`：先 `try { values = await form.validateFields() } catch { return }`，再跑 mutation。
- 接口 DTO 与表单值分开；`ProfileSettings.tsx` 通过 `toFormValues` 和 `toUpdateInput` 转换空字符串、换行文本和 `null`。
- 图标按钮使用 `lucide-react`，同时设置 `aria-label` 或 `Tooltip`。文件操作可参考 `FileList.tsx`。
- 删除等不可逆动作使用 `App.useApp().modal.confirm`，成功后用 `message.success`，失败时显示 `Error` 消息。
- 页面文案通过 `useTranslation` 和 `src/i18n/locales/{zh,en}.ts` 提供，不在领域组件里重复维护中英文分支。
- 表单字段对应 contracts 里已有 schema 时，用 `schema.safeParse(value)` 做 `validator` 而不是手抄正则，参考 `AiApplications.tsx` 的 `aiScopeIdSchema` 和 `RoleFormDrawers.tsx` 的 `roleKeySchema`。
- 页面同时存在侧边栏/局部搜索框与主文本域时，搜索框显式指定 `role="searchbox"`，确保无障碍语义与测试定位隔离。

## 资源型多选

资源名称、版本和描述较长时，不要把完整描述拼进 `Select` 的 `label`。在页面 feature 内使用可搜索的资源列表展示主名称和辅助信息，并将已选资源收进可折叠区域。

- 表单值继续保持 DTO 需要的简单值数组，例如 `string[]`；展示对象只在组件内部使用。
- 搜索文本应包含用户可见的名称、版本、描述和 scope，确保输入这些关键词都能筛选。
- 已选区域默认折叠，展开后提供逐项移除；资源列表和已选列表都使用固定最大高度并滚动，避免撑开 Drawer。
- 工具等存在版本约束的资源，展示精确版本，但将同名版本冲突校验保留在提交函数的统一业务校验中。

## 一次性凭据展示

创建或轮换应用凭据这类只返回一次的 secret，按 `features/ai/pages/AiApplications.tsx` 的做法：

- secret 只放组件 `useState`，用独立弹窗展示，弹窗关闭时清空 state 并调用 mutation 的 `reset()`，避免值留在 React Query 的 MutationCache。
- 不写入 query cache、URL、localStorage 和 `console`；列表接口只显示 `secretPrefix`。
- 弹窗要写清关闭后无法再查看，并标明是哪个应用的 secret。
- 复制按钮失败时给出可执行提示（手动选中复制），不吞掉错误。

## 不要做的事

不要在组件中直接调用 `fetch`、手动管理 React Query cache，或用 `any` 绕过表格/表单类型。请求应由 `apiRequest` 和对应 query hook 统一处理。
