'use client'

import React from 'react'

export interface ShinyTextProps {
  children?: React.ReactNode
  className?: string
  disabled?: boolean
  shimmerWidth?: number
  speed?: number
  text?: string
}

/**
 * React Bits - ShinyText 文字扫光动效
 * 通过背景渐变裁剪与平滑动画实现微光流动视觉。
 */
export function ShinyText({
  children,
  className = '',
  disabled = false,
  shimmerWidth = 100,
  speed = 5,
  text,
}: ShinyTextProps) {
  const content = text ?? children

  const animationDuration = `${speed}s`

  return (
    <span
      className={`inline-block bg-clip-text text-transparent ${disabled ? '' : 'animate-shiny-text'} ${className}`}
      style={{
        backgroundImage:
          'linear-gradient(120deg, rgba(255, 255, 255, 0) 30%, rgba(255, 255, 255, 0.85) 50%, rgba(255, 255, 255, 0) 70%)',
        backgroundPosition: '100% 0',
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${shimmerWidth}% 100%`,
        animationDuration,
      }}
    >
      {content}
    </span>
  )
}
