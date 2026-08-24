import type { AgentSession } from '@starter/contracts'

/**
 * 会话列表的本地更新规则，纯函数不碰 React 和 DOM。
 * 列表只存最近 20 条未归档会话，本地维护顺序，Run 进终态后由服务端列表整体校准。
 */

/** 已存在则原位替换，不存在则插到首位（新建会话选中后立即可见）。 */
export function upsertSession(items: AgentSession[], session: AgentSession): AgentSession[] {
  const index = items.findIndex((item) => item.id === session.id)
  if (index === -1) return [session, ...items]
  const next = [...items]
  next[index] = session
  return next
}

/** 按 id 过滤，剩余顺序不变。 */
export function removeSession(items: AgentSession[], sessionId: string): AgentSession[] {
  return items.filter((item) => item.id !== sessionId)
}

/** 移除 `archivedId` 后取首条 id；列表已空返回 null。 */
export function pickNextSessionId(items: AgentSession[], archivedId: string): string | null {
  return items.find((item) => item.id !== archivedId)?.id ?? null
}
