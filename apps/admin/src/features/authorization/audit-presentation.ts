import type { AuthorizationAuditEvent } from '@starter/contracts'

import { AuditActions } from '@starter/contracts'

export type AuditPayloadPresentation =
  | { kind: 'empty' }
  | { kind: 'keys'; added: string[]; keys: string[]; removed: string[] }
  | { kind: 'role-created'; description: string | null; name: string; permissionKeys: string[] }
  | { kind: 'role-metadata'; description: string | null; name: string }
  | { kind: 'role-status'; archived: boolean }

export function projectAuditPayload(
  event: AuthorizationAuditEvent,
  side: 'before' | 'after',
): AuditPayloadPresentation {
  if (event.action === AuditActions.ROLE_CREATED) {
    if (side === 'before') return { kind: 'empty' }
    return {
      kind: 'role-created',
      name: event.after.role.name,
      description: event.after.role.description,
      permissionKeys: event.after.role.permissionKeys,
    }
  }

  if (event.action === AuditActions.ROLE_UPDATED) {
    const payload = side === 'before' ? event.before : event.after
    return { kind: 'role-metadata', name: payload.name, description: payload.description }
  }

  if (event.action === AuditActions.ROLE_ARCHIVED || event.action === AuditActions.ROLE_RESTORED) {
    const payload = side === 'before' ? event.before : event.after
    return { kind: 'role-status', archived: payload.archived }
  }

  if ('roleKeys' in event.before && 'roleKeys' in event.after) {
    const before = event.before.roleKeys
    const after = event.after.roleKeys
    if (side === 'before') {
      return {
        kind: 'keys',
        keys: before,
        removed: before.filter((key) => !after.includes(key)),
        added: [],
      }
    }
    return {
      kind: 'keys',
      keys: after,
      removed: [],
      added: after.filter((key) => !before.includes(key)),
    }
  }

  if ('permissionKeys' in event.before && 'permissionKeys' in event.after) {
    const before = event.before.permissionKeys
    const after = event.after.permissionKeys
    if (side === 'before') {
      return {
        kind: 'keys',
        keys: before,
        removed: before.filter((key) => !after.includes(key)),
        added: [],
      }
    }
    return {
      kind: 'keys',
      keys: after,
      removed: [],
      added: after.filter((key) => !before.includes(key)),
    }
  }

  return { kind: 'empty' }
}
