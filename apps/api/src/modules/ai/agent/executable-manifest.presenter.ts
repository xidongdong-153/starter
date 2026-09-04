import type { AgentDefinitionSummary, ExecutableManifestV1 } from '@starter/contracts'
import {
  AI_EVENT_PROTOCOL_VERSION,
  executableAgentControls,
  executableAgentInputSchema,
  executableJsonObjectSchema,
  executableManifestV1Schema,
} from '@starter/contracts'
import { z } from 'zod'

import { canonicalJson, sha256Hex } from '../run/resolved-manifest.js'
import { strongestSideEffect } from '../runtime/app-policy.js'

import type { ResolvedAgentDefinition } from './agent.service.js'

const inputSchema = executableJsonObjectSchema.parse(z.toJSONSchema(executableAgentInputSchema, { target: 'draft-7' }))

export function toExecutableManifestV1(
  definition: Pick<AgentDefinitionSummary, 'id' | 'name' | 'description'>,
  resolved: ResolvedAgentDefinition,
): ExecutableManifestV1 {
  if (resolved.id === null || resolved.revision === null || resolved.id !== definition.id) {
    throw new Error('Executable Manifest 只能由对应的预设 Agent 生成')
  }

  const output = resolved.outputContract
    ? {
        contract: resolved.outputContract.ref,
        schema: executableJsonObjectSchema.parse(
          z.toJSONSchema(resolved.outputContract.schema, {
            target: 'draft-7',
          }),
        ),
      }
    : null
  const sideEffect = strongestSideEffect(resolved.tools.map((tool) => tool.sideEffect))
  const executionContract = {
    manifestSchemaVersion: 1,
    kind: 'agent',
    id: resolved.id,
    version: resolved.revision,
    inputSchema,
    output,
    eventProtocolVersion: AI_EVENT_PROTOCOL_VERSION,
    controls: executableAgentControls,
    sideEffect,
    execution: {
      model: resolved.model,
      thinkingLevel: resolved.thinkingLevel,
      maxTurns: resolved.maxTurns,
      retryPolicy: { maxAttempts: resolved.config.retryPolicy?.maxAttempts ?? 1 },
      systemPrompt: resolved.manifestFacts.systemPrompt
        ? {
            revision: resolved.manifestFacts.systemPrompt.revision,
            contentHash: resolved.manifestFacts.systemPrompt.contentHash,
          }
        : null,
      skills: resolved.manifestFacts.skills.map((skill) => ({
        id: skill.skillId,
        revision: skill.revision,
        contentHash: skill.contentHash,
      })),
      tools: resolved.tools.map((tool) => ({
        name: tool.name,
        version: tool.version,
        manifestHash: tool.manifestHash,
      })),
    },
  } as const

  return executableManifestV1Schema.parse({
    manifestSchemaVersion: executionContract.manifestSchemaVersion,
    kind: executionContract.kind,
    id: executionContract.id,
    version: executionContract.version,
    name: definition.name,
    description: definition.description,
    inputSchema: executionContract.inputSchema,
    output: executionContract.output,
    eventProtocolVersion: executionContract.eventProtocolVersion,
    controls: executionContract.controls,
    sideEffect: executionContract.sideEffect,
    manifestHash: sha256Hex(canonicalJson(executionContract)),
  })
}
