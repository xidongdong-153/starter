# Admin 状态管理规范

## 状态归属

- API 返回的数据放进 TanStack Query。query key 在对应的 `api/<domain>/*.query.ts` 中定义，例如 `filesQueryKeys` 和 `profileQueryKeys`。
- 主题、语言、侧栏、移动菜单和设置抽屉放进 `useSettingStore`。
- 标签页列表和当前标签页放进 `useTabBarStore`。
- 只影响当前组件的搜索词、预览文件和重命名文件保留在页面 `useState`，见 `features/files/pages/FileList.tsx`。
- 表单输入由 Ant Design Form 管理，不重复复制一份到 Zustand。

## Cache 更新

mutation 成功后只更新它实际影响的 query：资料更新用 `setQueryData`，头像和文件变化用 `invalidateQueries`。删除文件会同时失效文件列表和资料详情，因为删除操作会清理头像引用。

```tsx
onSuccess: async () => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: filesQueryKeys.list() }),
    queryClient.invalidateQueries({ queryKey: profileQueryKeys.detail() }),
  ]);
};
```

## 持久化边界

`useSettingStore` 只通过 `partialize` 持久化 `adminTheme`、`language` 和 `themeMode`；临时打开状态不写入 localStorage。`useTabBarStore` 负责规范化路径、去重和保留不可关闭的首页标签。

不要把 access token、请求对象或完整 API response 放进持久化 store。认证由 Better Auth cookie 和 `credentials: 'include'` 处理。
