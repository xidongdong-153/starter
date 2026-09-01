'use client'

import { useId } from 'react'
import { cn } from '@web/lib/utils'

export interface BorderBeamProps {
  borderWidth?: number
  className?: string
  colorFrom?: string
  colorTo?: string
  duration?: number
  pathLength?: number
  reverse?: boolean
  rx?: number | string
}

/**
 * React Bits - BorderBeam 边框环绕流光组件
 * 沿卡片或容器边框轮廓流动的高性能 SVG 光束。
 */
export function BorderBeam({
  borderWidth = 1.5,
  className,
  colorFrom = '#eb6f92',
  colorTo = '#9ccfd8',
  duration = 5,
  reverse = false,
  rx = 2,
}: BorderBeamProps) {
  const gradientId = useId()

  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 size-full overflow-visible', className)}
    >
      <svg className="size-full overflow-visible" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient gradientUnits="userSpaceOnUse" id={gradientId} x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor={colorFrom} stopOpacity="1" />
            <stop offset="50%" stopColor={colorTo} stopOpacity="0.8" />
            <stop offset="100%" stopColor={colorFrom} stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect
          height="100%"
          pathLength="100"
          rx={rx}
          stroke={`url(#${gradientId})`}
          strokeDasharray="22 78"
          strokeLinecap="round"
          strokeWidth={borderWidth}
          style={{
            animation: `border-beam-dash ${duration}s linear infinite ${reverse ? 'reverse' : 'normal'}`,
          }}
          width="100%"
        />
      </svg>
    </div>
  )
}
