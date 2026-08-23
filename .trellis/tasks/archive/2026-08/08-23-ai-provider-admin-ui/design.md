# 子任务技术设计

## 页面结构

保留现有 Provider 表格和模型白名单；新增 custom Provider 创建按钮和独立 Drawer/Modal。Provider row 用 `kind` 区分内置/自定义，内置不显示删除和协议编辑动作。

## 表单边界

表单值只使用 contracts input 类型。protocol 选择驱动 compat 字段；模型编辑先在本地表单 state 中维护，提交时转换成 API input。apiKey 只作为一次性写入值，不从 query 回填；返回只显示 mask/status。

## 状态和权限

页面继续使用 React Query。所有 custom mutation 成功/失败都失效 Provider、admin models、user models、preference query。manage 权限控制写操作和按钮；read 权限控制页面/列表。覆盖 loading、error、empty、pending、冲突和窄视口。

## 交互

保存配置后显示 needs_check；check 成功后允许 enable；删除必须二次确认，API 返回 in-use 时显示关联资源错误。内置 Provider 现有配置和模型白名单逻辑不改变。
