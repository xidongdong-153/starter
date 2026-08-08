# Admin 类型安全规范

## 共享 DTO

来自 API 的数据类型优先从 `@starter/contracts` 导入，使用 `import type`。`FileList.tsx` 使用 `FileItem`，`ProfileSettings.tsx` 使用 `AccountProfile` 和 `UpdateProfileInput`，不要在 Admin 重新复制接口 DTO。

```tsx
import type { AccountProfile, UpdateProfileInput } from "@starter/contracts";
import type { FileItem } from "@starter/contracts";
```

## 表单和 UI 类型

接口值与表单值可以不同，但转换必须显式。资料页把 `null` 转成输入框的空字符串，再把空白值转回 `null`，社交链接把多行文本转成非空数组。表格列使用 `TableProps<FileItem>['columns']`，避免 render 参数退化为 `any`。

## 路由和 store

- `RouterContext` 明确声明 `queryClient: QueryClient`，由 TanStack Router 创建根路由上下文。
- store interface 继承 `BaseStore`，所有 action 的参数和返回值写在 interface 中。
- 主题名称使用 `ThemeName`，主题模式使用 `'light' | 'dark' | 'system'`，外部字符串先通过 `resolveTheme` 或 `isThemeMode` 收窄。
- Map 查找要提供默认值，例如 `antdLocaleMap[language] ?? zhCN`。

## 不要做的事

不要用 `as any` 绕过 API response、表格行或路由数据类型；需要断言时使用 contracts schema、`satisfies` 或局部的明确类型断言，并说明数据来源。
