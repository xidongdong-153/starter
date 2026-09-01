'use client'

import React from 'react'

export interface ShinyTextProps {
  baseColor?: string
  children?: React.ReactNode
  className?: string
  disabled?: boolean
  shimmerWidth?: number
  shineColor?: string
  speed?: number
  text?: string
}

/**
 * React Bits - ShinyText 文字扫光动效
 * 保持文字底色清晰可读，高光以平稳柔和的节奏掠过，兼顾暗色/亮色主题与易读性。
 */
export function ShinyText({
  baseColor,
  children,
  className = '',
  disabled = false,
  shimmerWidth = 220,
  shineColor,
  speed = 4.5,
  text,
}: ShinyTextProps) {
  const content = text ?? children

  // 默认底色保留足够的可见度（~70%），高光为全亮；避免暗色下底色全透明看不见字
  const effectiveBase = baseColor ?? 'color-mix(in srgb, currentColor 68%, transparent)'
  const effectiveShine = shineColor ?? 'currentColor'
  const animationDuration = `${speed}s`

  return (
    <span
      className={`inline-block bg-clip-text text-transparent transition-opacity ${
        disabled ? '' : 'animate-shiny-text'
      } ${className}`}
      style={{
        backgroundImage: `linear-gradient(120deg, ${effectiveBase} 0%, ${effectiveBase} 38%, ${effectiveShine} 50%, ${effectiveBase} 62%, ${effectiveBase} 100%)`,
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
