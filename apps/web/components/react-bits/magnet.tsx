'use client'

import React, { useEffect, useRef, useState } from 'react'

export interface MagnetProps {
  active?: boolean
  children: React.ReactNode
  className?: string
  disabled?: boolean
  magnetStrength?: number
  padding?: number
}

/**
 * React Bits - Magnet 磁性吸附容器组件
 * 当鼠标移动至元素范围内时，轻量跟随光标位移，移开后弹性回弹。
 */
export function Magnet({
  active = true,
  children,
  className = '',
  disabled = false,
  magnetStrength = 0.35,
  padding = 40,
}: MagnetProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const magnetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (disabled || !active) {
      setPosition({ x: 0, y: 0 })
      return
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return

    const handleMouseMove = (event: MouseEvent) => {
      const element = magnetRef.current
      if (!element) return

      const { height, left, top, width } = element.getBoundingClientRect()
      const centerX = left + width / 2
      const centerY = top + height / 2

      const distX = Math.abs(centerX - event.clientX)
      const distY = Math.abs(centerY - event.clientY)

      if (distX < width / 2 + padding && distY < height / 2 + padding) {
        const offsetX = (event.clientX - centerX) * magnetStrength
        const offsetY = (event.clientY - centerY) * magnetStrength
        setPosition({ x: offsetX, y: offsetY })
      } else {
        setPosition({ x: 0, y: 0 })
      }
    }

    window.addEventListener('mousemove', handleMouseMove)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
    }
  }, [active, disabled, magnetStrength, padding])

  return (
    <div
      className={`inline-block transition-transform duration-200 ease-out ${className}`}
      ref={magnetRef}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        willChange: 'transform',
      }}
    >
      {children}
    </div>
  )
}
