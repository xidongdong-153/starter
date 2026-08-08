# API 的状态边界

API runtime 是每个进程共享的基础设施，不承担浏览器 UI 状态。请求级状态只放在 Hono context：`requestId`、`startedAt`、`logger` 和认证后的 `currentUserId`。

数据库中的 profile、files、session 是持久状态；服务层通过 repository 读取或更新。前端的 React Query cache、Zustand store 和表单状态不能写入 API runtime，也不能通过模块级可变变量模拟用户状态。

需要把新状态提供给客户端时，定义 contracts DTO 和 route response，并由客户端自行决定 cache 或 UI 状态归属。
