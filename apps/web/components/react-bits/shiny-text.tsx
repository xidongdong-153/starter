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
 * 采用 CSS mask-image 实现柔和流光，完全保留文字原有原生颜色与主题对比度，
 * 绝不会出现文字底色透明或暗色模式下看不清的问题。
 */
export function ShinyText({
  children,
  className = '',
  disabled = false,
  shimmerWidth = 200,
  speed = 4.5,
  text,
}: ShinyTextProps) {
  const content = text ?? children
  const animationDuration = `${speed}s`

  return (
    <span
      className={`inline-block transition-opacity ${disabled ? '' : 'animate-shiny-text'} ${className}`}
      style={{
        WebkitMaskImage:
          'linear-gradient(120deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.65) 35%, rgba(0,0,0,1) 50%, rgba(0,0,0,0.65) 65%, rgba(0,0,0,0.65) 100%)',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskSize: `${shimmerWidth}% 100%`,
        animationDuration,
        maskImage:
          'linear-gradient(120deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.65) 35%, rgba(0,0,0,1) 50%, rgba(0,0,0,0.65) 65%, rgba(0,0,0,0.65) 100%)',
        maskRepeat: 'no-repeat',
        maskSize: `${shimmerWidth}% 100%`,
      }}
    >
      {content}
    </span>
  )
}
