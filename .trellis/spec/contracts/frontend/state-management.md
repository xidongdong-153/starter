# Contracts 的状态边界

contracts 是无状态的纯模块。它不读 localStorage、不保存 session、不缓存 API response，也不维护表单状态。

- Admin 使用 React Query 保存 server state，Zustand 保存主题和标签页。
- Web 使用 Better Auth client 保存 session 读取结果，组件 state 保存表单、菜单和主题设置。
- API 使用数据库和 request context 保存服务端状态。

新增字段只修改数据契约和构造函数；状态生命周期由消费方负责。
