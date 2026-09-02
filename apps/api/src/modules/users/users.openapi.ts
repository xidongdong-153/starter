import {
  updateUserStatusResponseSchema as updateUserStatusResponseSchemaBase,
  updateUserStatusSchema,
  userManagementQuerySchema,
  userManagementUserDetailSchema as userManagementUserDetailSchemaBase,
  userManagementUserPageSchema as userManagementUserPageSchemaBase,
  userIdParamsSchema,
} from '@starter/contracts'
import { nameSchema } from '@api/openapi/name-schema.js'

export { updateUserStatusSchema as updateUserStatusBodySchema, userIdParamsSchema, userManagementQuerySchema }

export const updateUserStatusResponseSchema = updateUserStatusResponseSchemaBase

export const userManagementUserPageSchema = nameSchema(userManagementUserPageSchemaBase, 'UserManagementUserPage')

export const userManagementUserDetailSchema = nameSchema(userManagementUserDetailSchemaBase, 'UserManagementUserDetail')
