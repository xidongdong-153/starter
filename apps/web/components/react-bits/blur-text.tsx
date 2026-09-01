'use client'

import { useEffect, useRef, useState } from 'react'

export interface BlurTextProps {
  animateBy?: 'letters' | 'words'
  className?: string
  delay?: number
  direction?: 'bottom' | 'top'
  onAnimationComplete?: () => void
  text: string
  threshold?: number
}

/**
 * React Bits - BlurText 文字模糊渐变入场动效
 * 将文本拆分为单词或字母，逐个从模糊与位移中平滑展开。
 */
export function BlurText({
  animateBy = 'words',
  className = '',
  delay = 80,
  direction = 'top',
  onAnimationComplete,
  text,
  threshold = 0.1,
}: BlurTextProps) {
  const [inView, setInView] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true)
          observer.unobserve(element)
        }
      },
      { threshold },
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [threshold])

  const elements = animateBy === 'words' ? text.split(' ') : text.split('')

  useEffect(() => {
    if (inView && onAnimationComplete) {
      const totalTime = elements.length * delay + 500
      const timer = setTimeout(onAnimationComplete, totalTime)
      return () => clearTimeout(timer)
    }
  }, [inView, elements.length, delay, onAnimationComplete])

  return (
    <p className={`inline-flex flex-wrap ${className}`} ref={ref}>
      {elements.map((segment, index) => {
        const translateY = direction === 'top' ? '-14px' : '14px'
        const transitionDelay = `${index * delay}ms`

        return (
          <span
            className="inline-block transition-all duration-700 ease-[cubic-bezier(0.2,0.65,0.3,0.9)]"
            key={index}
            style={{
              filter: inView ? 'blur(0px)' : 'blur(10px)',
              opacity: inView ? 1 : 0,
              transform: inView ? 'translate3d(0, 0, 0)' : `translate3d(0, ${translateY}, 0)`,
              transitionDelay,
              whiteSpace: 'pre',
            }}
          >
            {segment}
            {animateBy === 'words' && index < elements.length - 1 ? '\u00A0' : ''}
          </span>
        )
      })}
    </p>
  )
}
