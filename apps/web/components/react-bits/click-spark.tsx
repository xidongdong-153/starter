'use client'

import React, { useCallback, useEffect, useRef } from 'react'

export interface ClickSparkProps {
  children: React.ReactNode
  className?: string
  duration?: number
  sparkColor?: string
  sparkCount?: number
  sparkRadius?: number
  sparkSize?: number
}

interface Spark {
  alpha: number
  angle: number
  color: string
  distance: number
  maxDistance: number
  size: number
  speed: number
  x: number
  y: number
}

/**
 * React Bits - ClickSpark 点击火花微动效
 * 点击元素时向外溅射细微粒子火花。
 */
export function ClickSpark({
  children,
  className = '',
  duration = 450,
  sparkColor = 'rgba(235, 111, 146, 0.9)',
  sparkCount = 8,
  sparkRadius = 25,
  sparkSize = 2.5,
}: ClickSparkProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sparksRef = useRef<Spark[]>([])
  const animationIdRef = useRef<number | null>(null)

  const drawSparks = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    sparksRef.current = sparksRef.current.filter((spark) => spark.alpha > 0.02)

    for (const spark of sparksRef.current) {
      spark.distance += spark.speed
      spark.alpha *= 0.92

      const currentX = spark.x + Math.cos(spark.angle) * spark.distance
      const currentY = spark.y + Math.sin(spark.angle) * spark.distance

      ctx.save()
      ctx.beginPath()
      ctx.arc(currentX, currentY, spark.size * (spark.alpha + 0.2), 0, Math.PI * 2)
      ctx.fillStyle = spark.color
      ctx.globalAlpha = spark.alpha
      ctx.fill()
      ctx.restore()
    }

    if (sparksRef.current.length > 0) {
      animationIdRef.current = requestAnimationFrame(drawSparks)
    } else {
      animationIdRef.current = null
    }
  }, [])

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.resetTransform()
      ctx.scale(dpr, dpr)
    }

    const clickX = event.clientX - rect.left
    const clickY = event.clientY - rect.top

    const newSparks: Spark[] = Array.from({ length: sparkCount }).map((_, index) => {
      const angle = (Math.PI * 2 * index) / sparkCount + (Math.random() - 0.5) * 0.4
      return {
        alpha: 1,
        angle,
        color: sparkColor,
        distance: 0,
        maxDistance: sparkRadius * (0.8 + Math.random() * 0.4),
        size: sparkSize * (0.7 + Math.random() * 0.6),
        speed: (sparkRadius / (duration / 16)) * (0.8 + Math.random() * 0.4),
        x: clickX,
        y: clickY,
      }
    })

    sparksRef.current.push(...newSparks)

    if (animationIdRef.current === null) {
      animationIdRef.current = requestAnimationFrame(drawSparks)
    }
  }

  useEffect(() => {
    return () => {
      if (animationIdRef.current !== null) {
        cancelAnimationFrame(animationIdRef.current)
      }
    }
  }, [])

  return (
    <div className={`relative ${className}`} onClick={handleClick} ref={containerRef}>
      <canvas aria-hidden="true" className="pointer-events-none absolute inset-0 size-full z-30" ref={canvasRef} />
      {children}
    </div>
  )
}
