import type { RouteComponent } from '@tanstack/react-router'
import type { LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'

export type AdminRouteComponent = RouteComponent

export interface AdminLayoutMeta {
  contentWidth?: 'default' | 'full'
}

export interface AdminMenuMeta {
  group?: string
  order?: number
}

export interface AdminTabMeta {
  closable?: boolean
}

export interface AdminRouteRecord {
  component: AdminRouteComponent
  icon?: ComponentType<LucideProps>
  id: string
  layout?: AdminLayoutMeta
  /** menu 为 false 时不进菜单 */
  menu?: false | AdminMenuMeta
  path: string
  /** tab 为 false 时不生成标签页 */
  tab?: false | AdminTabMeta
  title: string
}

export interface AppRouteMeta {
  icon?: ComponentType<LucideProps>
  id?: string
  layout?: AdminLayoutMeta
  tab?: false | AdminTabMeta
  title?: string
}

/**
 * 把 TanStack Router 的 staticData 解析成业务路由元信息
 */
export function resolveRouteMeta(staticData: unknown): AppRouteMeta {
  if (!staticData || typeof staticData !== 'object') {
    return {}
  }

  return staticData as AppRouteMeta
}
