'use client'

import React, { useRef, useState } from 'react'
import { cn } from '@web/lib/utils'

export interface SpotlightCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  className?: string
  spotlightColor?: string
  spotlightRadius?: number
}

/**
 * React Bits - SpotlightCard 聚光灯光晕卡片
 * 鼠标悬停在卡片上时，跟随光标位置渲染柔和径向聚光灯与边框高光。
 */
export function SpotlightCard({
  children,
  className = '',
  spotlightColor = 'rgba(235, 111, 146, 0.18)',
  spotlightRadius = 320,
  ...props
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: -1000, y: -1000 })
  const [opacity, setOpacity] = useState(0)

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    setPosition({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    })
    setOpacity(1)
  }

  const handleMouseEnter = () => {
    setOpacity(1)
  }

  const handleMouseLeave = () => {
    setOpacity(0)
  }

  return (
    <div
      className={cn('relative overflow-hidden', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      ref={cardRef}
      {...props}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px transition-opacity duration-300"
        style={{
          background: `radial-gradient(${spotlightRadius}px circle at ${position.x}px ${position.y}px, ${spotlightColor}, transparent 80%)`,
          opacity,
        }}
      />
      {children}
    </div>
  )
}
