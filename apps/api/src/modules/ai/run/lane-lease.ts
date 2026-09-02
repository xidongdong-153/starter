import { and, eq, gt, lt, sql } from 'drizzle-orm'

import type { AppDatabase } from '@api/infra/db/client.js'
import { aiAgentLaneLeases } from '@api/modules/ai/ai.schema.js'

/** lease 有效期：进程停止续租后最多这么久，lane 就能被新 owner 接管。 */
export const LEASE_TTL_MS = 90_000
/** 执行期间的续租间隔；必须小于 LEASE_TTL_MS，执行中至少有两次续租机会。 */
export const RENEW_INTERVAL_MS = 30_000

/** 一次成功 acquire 拿到的所有权凭据；续租、释放和终态校验都带同一对值。 */
export interface LaneLeaseOwner {
  ownerId: string
  fencingToken: number
}

export interface LaneLeaseStoreOptions {
  /** 测试注入短 TTL 验证过期接管与续租失败；生产用 LEASE_TTL_MS。 */
  ttlMs?: number
  /** 测试注入短续租间隔；生产用 RENEW_INTERVAL_MS。 */
  renewIntervalMs?: number
}

export interface LaneLeaseStore {
  /** 续租定时器的间隔；Run Service 用它启动周期续租。 */
  readonly renewIntervalMs: number
  /**
   * 领取 lane 的执行所有权。lane 无行时插入（token 从 1 起）；
   * 已过期的行允许接管（token + 1）；未过期一律返回 'busy'，
   * 包括同 owner 重复 acquire：进程内 registry 快速路径未拦住说明是异常重入。
   */
  acquire: (input: { sessionId: string; lane: string; ownerId: string }) => LaneLeaseOwner | 'busy'
  /** 续租：owner、token 匹配且未过期才生效；返回 false 表示已失去所有权。 */
  renew: (input: { sessionId: string; lane: string; owner: LaneLeaseOwner }) => boolean
  /** 释放：owner、token 匹配才删除行；被接管后晚到的释放删 0 行，无副作用。 */
  release: (input: { sessionId: string; lane: string; owner: LaneLeaseOwner }) => boolean
  /** 删除指定 lane 的已过期 lease；未过期行不动，可能属于仍在执行的其他实例。 */
  releaseExpired: (lanes: ReadonlyArray<{ sessionId: string; lane: string }>) => number
}

/**
 * Session lane 执行所有权的持久 lease。
 *
 * 三个操作都是单条条件 SQL，better-sqlite3 同步执行。排他权威在这里，
 * 进程内 ActiveRunRegistry 只保留同进程快速失败路径。
 */
export function createLaneLeaseStore(db: AppDatabase, options: LaneLeaseStoreOptions = {}): LaneLeaseStore {
  const ttlMs = options.ttlMs ?? LEASE_TTL_MS
  const renewIntervalMs = options.renewIntervalMs ?? RENEW_INTERVAL_MS

  function acquire(input: { sessionId: string; lane: string; ownerId: string }): LaneLeaseOwner | 'busy' {
    const now = Date.now()
    return db.transaction((tx) => {
      // lane 无行：直接插入。冲突时 INSERT 被忽略，走下面的过期接管。
      const inserted = tx
        .insert(aiAgentLaneLeases)
        .values({
          sessionId: input.sessionId,
          lane: input.lane,
          ownerId: input.ownerId,
          fencingToken: 1,
          leaseUntil: now + ttlMs,
          heartbeatAt: now,
          acquiredAt: now,
        })
        .onConflictDoNothing()
        .run()
      if (inserted.changes > 0) return { ownerId: input.ownerId, fencingToken: 1 }

      // 已有行且已过期：接管并递增 fencing token；未过期返回 busy。
      const takeover = tx
        .update(aiAgentLaneLeases)
        .set({
          ownerId: input.ownerId,
          fencingToken: sql`${aiAgentLaneLeases.fencingToken} + 1`,
          leaseUntil: now + ttlMs,
          heartbeatAt: now,
          acquiredAt: now,
        })
        .where(
          and(
            eq(aiAgentLaneLeases.sessionId, input.sessionId),
            eq(aiAgentLaneLeases.lane, input.lane),
            lt(aiAgentLaneLeases.leaseUntil, now),
          ),
        )
        .returning({ fencingToken: aiAgentLaneLeases.fencingToken })
        .get()
      if (takeover) return { ownerId: input.ownerId, fencingToken: takeover.fencingToken }
      return 'busy'
    })
  }

  function renew(input: { sessionId: string; lane: string; owner: LaneLeaseOwner }): boolean {
    const now = Date.now()
    const result = db
      .update(aiAgentLaneLeases)
      .set({ leaseUntil: now + ttlMs, heartbeatAt: now })
      .where(
        and(
          eq(aiAgentLaneLeases.sessionId, input.sessionId),
          eq(aiAgentLaneLeases.lane, input.lane),
          eq(aiAgentLaneLeases.ownerId, input.owner.ownerId),
          eq(aiAgentLaneLeases.fencingToken, input.owner.fencingToken),
          gt(aiAgentLaneLeases.leaseUntil, now),
        ),
      )
      .run()
    return result.changes > 0
  }

  function release(input: { sessionId: string; lane: string; owner: LaneLeaseOwner }): boolean {
    const result = db
      .delete(aiAgentLaneLeases)
      .where(
        and(
          eq(aiAgentLaneLeases.sessionId, input.sessionId),
          eq(aiAgentLaneLeases.lane, input.lane),
          eq(aiAgentLaneLeases.ownerId, input.owner.ownerId),
          eq(aiAgentLaneLeases.fencingToken, input.owner.fencingToken),
        ),
      )
      .run()
    return result.changes > 0
  }

  function releaseExpired(lanes: ReadonlyArray<{ sessionId: string; lane: string }>): number {
    const now = Date.now()
    let deleted = 0
    for (const lane of lanes) {
      const result = db
        .delete(aiAgentLaneLeases)
        .where(
          and(
            eq(aiAgentLaneLeases.sessionId, lane.sessionId),
            eq(aiAgentLaneLeases.lane, lane.lane),
            lt(aiAgentLaneLeases.leaseUntil, now),
          ),
        )
        .run()
      deleted += result.changes
    }
    return deleted
  }

  return { renewIntervalMs, acquire, renew, release, releaseExpired }
}
