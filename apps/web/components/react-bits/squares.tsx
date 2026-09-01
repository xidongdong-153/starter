'use client'

import { useEffect, useRef } from 'react'

export interface SquaresProps {
  borderColor?: string
  className?: string
  direction?: 'diagonal' | 'down' | 'left' | 'right' | 'up'
  hoverFillColor?: string
  speed?: number
  squareSize?: number
}

/**
 * React Bits - Squares 背景组件
 * 基于 Canvas 的网格交互背景，支持方向漂移与鼠标悬停高亮。
 */
export function Squares({
  borderColor = 'rgba(128, 128, 128, 0.12)',
  className = '',
  direction = 'diagonal',
  hoverFillColor = 'rgba(235, 111, 146, 0.12)',
  speed = 0.5,
  squareSize = 40,
}: SquaresProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoveredSquareRef = useRef<{ x: number; y: number } | null>(null)
  const gridOffsetRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.resetTransform()
      ctx.scale(dpr, dpr)
    }

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas()
    })
    resizeObserver.observe(canvas)
    resizeCanvas()

    const handleMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const mouseX = event.clientX - rect.left
      const mouseY = event.clientY - rect.top

      const startX = Math.floor((mouseX - (gridOffsetRef.current.x % squareSize)) / squareSize)
      const startY = Math.floor((mouseY - (gridOffsetRef.current.y % squareSize)) / squareSize)

      hoveredSquareRef.current = { x: startX, y: startY }
    }

    const handleMouseLeave = () => {
      hoveredSquareRef.current = null
    }

    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseleave', handleMouseLeave)

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const width = rect.width
      const height = rect.height

      ctx.clearRect(0, 0, width, height)

      const startX = Math.floor(gridOffsetRef.current.x / squareSize) * squareSize
      const startY = Math.floor(gridOffsetRef.current.y / squareSize) * squareSize

      for (let x = startX - squareSize; x < width + squareSize; x += squareSize) {
        for (let y = startY - squareSize; y < height + squareSize; y += squareSize) {
          const squareX = x - (gridOffsetRef.current.x % squareSize)
          const squareY = y - (gridOffsetRef.current.y % squareSize)

          if (hoveredSquareRef.current) {
            const currentGridX = Math.floor((squareX + (gridOffsetRef.current.x % squareSize)) / squareSize)
            const currentGridY = Math.floor((squareY + (gridOffsetRef.current.y % squareSize)) / squareSize)

            if (hoveredSquareRef.current.x === currentGridX && hoveredSquareRef.current.y === currentGridY) {
              ctx.fillStyle = hoverFillColor
              ctx.fillRect(squareX, squareY, squareSize, squareSize)
            }
          }

          ctx.strokeStyle = borderColor
          ctx.lineWidth = 1
          ctx.strokeRect(squareX, squareY, squareSize, squareSize)
        }
      }

      if (!prefersReducedMotion && speed > 0) {
        switch (direction) {
          case 'right':
            gridOffsetRef.current.x -= speed
            break
          case 'left':
            gridOffsetRef.current.x += speed
            break
          case 'down':
            gridOffsetRef.current.y -= speed
            break
          case 'up':
            gridOffsetRef.current.y += speed
            break
          case 'diagonal':
            gridOffsetRef.current.x -= speed * 0.7
            gridOffsetRef.current.y -= speed * 0.7
            break
        }
      }

      animationFrameId = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(animationFrameId)
      resizeObserver.disconnect()
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [borderColor, direction, hoverFillColor, speed, squareSize])

  return (
    <canvas
      aria-hidden="true"
      className={`pointer-events-auto absolute inset-0 size-full ${className}`}
      ref={canvasRef}
    />
  )
}
