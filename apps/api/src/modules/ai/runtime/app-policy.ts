import type { AiApplicationPolicy, AiToolSideEffect, ExecutableControl, ExecutableManifestV1 } from '@starter/contracts'
import { ApiErrorCodes } from '@starter/contracts'

import { AppError } from '@api/shared/app-error.js'
import type { RuntimeAccessContext } from '../principal.js'

const sideEffectRank: Record<AiToolSideEffect, number> = {
  read_only: 0,
  idempotent_write: 1,
  non_idempotent_write: 2,
}

export function strongestSideEffect(sideEffects: readonly AiToolSideEffect[]): AiToolSideEffect {
  return sideEffects.reduce<AiToolSideEffect>(
    (strongest, sideEffect) => (sideEffectRank[sideEffect] > sideEffectRank[strongest] ? sideEffect : strongest),
    'read_only',
  )
}

export function enforceStartPolicy(
  access: RuntimeAccessContext,
  resolved: {
    id: string | null
    revision: number | null
    tools: readonly AiToolSideEffect[]
  },
): void {
  if (access.principal.kind !== 'product_app') return
  const policy = access.policy
  const executable = policy?.executables.find((item) => item.id === resolved.id)
  if (
    !policy ||
    resolved.id === null ||
    resolved.revision === null ||
    executable === undefined ||
    executable.version !== resolved.revision ||
    !sideEffectAllowed(strongestSideEffect(resolved.tools), policy.maxSideEffect)
  ) {
    throw policyForbidden('应用策略不允许执行该 Agent')
  }
}

export function enforceControlPolicy(access: RuntimeAccessContext, control: ExecutableControl): void {
  if (access.principal.kind !== 'product_app') return
  if (!access.policy || !access.policy.controls.includes(control)) {
    throw policyForbidden('应用策略不允许执行该控制操作')
  }
}

export function manifestAllowedByPolicy(manifest: ExecutableManifestV1, policy: AiApplicationPolicy): boolean {
  const executable = policy.executables.find((item) => item.id === manifest.id)
  return executable?.version === manifest.version && sideEffectAllowed(manifest.sideEffect, policy.maxSideEffect)
}

function sideEffectAllowed(actual: AiToolSideEffect, maximum: AiToolSideEffect): boolean {
  return sideEffectRank[actual] <= sideEffectRank[maximum]
}

function policyForbidden(message: string): AppError {
  return new AppError(ApiErrorCodes.AI_APP_POLICY_FORBIDDEN, message, 403)
}
