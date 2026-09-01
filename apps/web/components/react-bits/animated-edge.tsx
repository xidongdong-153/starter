'use client'

import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export interface AnimatedEdgeData {
  isAnimated?: boolean
  pulseColor?: string
  [key: string]: unknown
}

/**
 * React Bits - AnimatedPulseEdge 流程动态脉冲连线
 * 当流程运行时，在连线上沿路径流动能量光斑粒子。
 */
export function AnimatedPulseEdge({
  data,
  id,
  markerEnd,
  sourcePosition,
  sourceX,
  sourceY,
  style = {},
  targetPosition,
  targetX,
  targetY,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  })

  const edgeData = data as AnimatedEdgeData | undefined
  const isAnimated = edgeData?.isAnimated ?? false
  const pulseColor = edgeData?.pulseColor ?? 'var(--color-primary, #eb6f92)'

  return (
    <>
      <BaseEdge id={id} markerEnd={markerEnd} path={edgePath} style={style} />
      {isAnimated ? (
        <g>
          {/* 主能量粒子 */}
          <circle fill={pulseColor} r="3.5">
            <animateMotion dur="1.6s" path={edgePath} repeatCount="indefinite" />
          </circle>
          {/* 拖尾光晕 */}
          <circle fill={pulseColor} opacity="0.4" r="5">
            <animateMotion dur="1.6s" path={edgePath} repeatCount="indefinite" />
          </circle>
        </g>
      ) : null}
    </>
  )
}
