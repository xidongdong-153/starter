import { Loading } from './Loading'
import { Pattern } from './Pattern'

/**
 * 路由切换时的占位页
 */
export function HydrateFallback() {
  return (
    <div className="relative h-screen w-screen">
      <Pattern />
      <Loading fullScreen />
    </div>
  )
}
