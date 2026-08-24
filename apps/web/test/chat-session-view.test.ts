import { randomUUID } from 'node:crypto'
import type { AgentSession } from '@starter/contracts'
import { expect, it } from 'vitest'
import { pickNextSessionId, removeSession, upsertSession } from '@web/lib/ai/chat-session-view'

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    title: '测试会话',
    defaultAgentId: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const base = [
  session({ id: 'a', title: '会话 A' }),
  session({ id: 'b', title: '会话 B' }),
  session({ id: 'c', title: '会话 C' }),
]

it('upsertSession 已存在时原位替换，位置和其余顺序不变', () => {
  const updated = session({ id: 'b', title: '改名后的 B' })
  const next = upsertSession(base, updated)
  expect(next).toHaveLength(3)
  expect(next.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  expect(next[1]?.title).toBe('改名后的 B')
})

it('upsertSession 不存在时插到首位', () => {
  const created = session({ id: 'd', title: '新会话' })
  const next = upsertSession(base, created)
  expect(next).toHaveLength(4)
  expect(next[0]?.id).toBe('d')
  expect(next.map((item) => item.id)).toEqual(['d', 'a', 'b', 'c'])
})

it('upsertSession 空列表插入成为首条', () => {
  const next = upsertSession([], session({ id: 'e' }))
  expect(next.map((item) => item.id)).toEqual(['e'])
})

it('removeSession 按 id 过滤，剩余顺序不变', () => {
  const next = removeSession(base, 'b')
  expect(next.map((item) => item.id)).toEqual(['a', 'c'])
})

it('removeSession 移除不存在的 id 返回原列表', () => {
  expect(removeSession(base, 'missing').map((item) => item.id)).toEqual(['a', 'b', 'c'])
})

it('pickNextSessionId 归档首条后取剩余首条', () => {
  expect(pickNextSessionId(base, 'a')).toBe('b')
})

it('pickNextSessionId 归档非首条时仍取原首条', () => {
  expect(pickNextSessionId(base, 'b')).toBe('a')
})

it('pickNextSessionId 归档不存在的 id 时取原首条', () => {
  expect(pickNextSessionId(base, 'missing')).toBe('a')
})

it('pickNextSessionId 归档最后一条后返回 null', () => {
  expect(pickNextSessionId([session({ id: 'a' })], 'a')).toBeNull()
})

it('pickNextSessionId 空列表返回 null', () => {
  expect(pickNextSessionId([], 'a')).toBeNull()
})
