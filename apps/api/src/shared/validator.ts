import { ApiErrorCodes } from '@starter/contracts'
import { z } from 'zod'
import { AppError } from './app-error.js'

type FlattenableZodError = Parameters<typeof z.flattenError>[0]

export function throwValidationError(error: FlattenableZodError): never {
  throw new AppError(ApiErrorCodes.COMMON_INVALID_REQUEST, '请求参数不正确', 400, z.flattenError(error))
}
