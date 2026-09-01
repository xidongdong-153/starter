'use client'

import { useEffect, useRef } from 'react'

export interface ParticlesProps {
  className?: string
  ease?: number
  particleColors?: string[]
  particleCount?: number
  particleHoverFactor?: number
  particleSize?: number
  speed?: number
}

interface Particle {
  alpha: number
  color: string
  originalX: number
  originalY: number
  radius: number
  vx: number
  vy: number
  x: number
  y: number
}

/**
 * React Bits - Particles 粒子背景组件
 * 轻量 Canvas 粒子漂浮动效，支持鼠标微量排斥与主题颜色适配。
 * 自身采用 pointer-events-none，绝不阻挡任何上层交互或下拉菜单。
 */
export function Particles({
  className = '',
  ease = 50,
  particleColors = ['rgba(235, 111, 146, 0.4)', 'rgba(196, 167, 231, 0.35)', 'rgba(156, 207, 216, 0.35)'],
  particleCount = 36,
  particleHoverFactor = 1.8,
  particleSize = 2,
  speed = 0.3,
}: ParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0
    let height = 0
    const mouse = { x: -1000, y: -1000 }

    const particles: Particle[] = []

    const initParticles = () => {
      particles.length = 0
      for (let i = 0; i < particleCount; i++) {
        const x = Math.random() * width
        const y = Math.random() * height
        const color =
          particleColors[Math.floor(Math.random() * particleColors.length)] ?? particleColors[0] ?? '#eb6f92'
        const radius = (Math.random() * 0.8 + 0.6) * particleSize
        const angle = Math.random() * Math.PI * 2
        const s = (Math.random() * 0.5 + 0.5) * speed

        particles.push({
          alpha: Math.random() * 0.5 + 0.3,
          color,
          originalX: x,
          originalY: y,
          radius,
          vx: Math.cos(angle) * s,
          vy: Math.sin(angle) * s,
          x,
          y,
        })
      }
    }

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.resetTransform()
      ctx.scale(dpr, dpr)
      initParticles()
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    resize()

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      mouse.x = e.clientX - rect.left
      mouse.y = e.clientY - rect.top
    }

    const handleMouseLeave = () => {
      mouse.x = -1000
      mouse.y = -1000
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseleave', handleMouseLeave)

    const draw = () => {
      ctx.clearRect(0, 0, width, height)

      for (const p of particles) {
        if (!prefersReducedMotion) {
          p.x += p.vx
          p.y += p.vy

          if (p.x < 0) p.x = width
          if (p.x > width) p.x = 0
          if (p.y < 0) p.y = height
          if (p.y > height) p.y = 0

          // 鼠标微量排斥
          const dx = mouse.x - p.x
          const dy = mouse.y - p.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const maxDist = 80
          if (dist < maxDist && dist > 0) {
            const force = ((maxDist - dist) / maxDist) * particleHoverFactor
            p.x -= (dx / dist) * force
            p.y -= (dy / dist) * force
          }
        }

        ctx.save()
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.globalAlpha = p.alpha
        ctx.fill()
        ctx.restore()
      }

      animationFrameId = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(animationFrameId)
      resizeObserver.disconnect()
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [ease, particleColors, particleCount, particleHoverFactor, particleSize, speed])

  return (
    <canvas
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 size-full ${className}`}
      ref={canvasRef}
    />
  )
}
