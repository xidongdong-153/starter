/**
 * Store 相关的类型定义
 */

// 基础 Store 接口
export interface BaseStore {
  // 重置 store 到初始状态
  reset?: () => void
}

// Store 切片类型
export type StoreSlice<T> = (set: (partial: T | Partial<T> | ((state: T) => T | Partial<T>)) => void, get: () => T) => T

// 持久化配置
export interface PersistConfig<T = unknown> {
  name: string
  partialize?: (state: T) => Partial<T>
  storage?: Storage
  version?: number
}
