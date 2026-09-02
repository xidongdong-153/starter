import * as aiSchema from '@api/modules/ai/ai.schema.js'
import * as authSchema from '@api/modules/auth/auth.schema.js'
import * as authorizationSchema from '@api/modules/authorization/authorization.schema.js'
import * as filesSchema from '@api/modules/files/files.schema.js'
import * as profileSchema from '@api/modules/profile/profile.schema.js'

export * from '@api/modules/ai/ai.schema.js'
export * from '@api/modules/auth/auth.schema.js'
export * from '@api/modules/authorization/authorization.schema.js'
export * from '@api/modules/files/files.schema.js'
export * from '@api/modules/profile/profile.schema.js'

// 传给 drizzle client 和 drizzle-kit 的表与 relations 集合。
// 新增模块 schema 后在这里加一条 import 和一次展开。
export const schema = {
  ...aiSchema,
  ...authSchema,
  ...authorizationSchema,
  ...filesSchema,
  ...profileSchema,
}
