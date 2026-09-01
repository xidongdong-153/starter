'use client'

import React, { useEffect, useRef, useState } from 'react'

export interface DecryptedTextProps {
  animateOn?: 'hover' | 'view'
  characters?: string
  className?: string
  encryptedClassName?: string
  maxIterations?: number
  parentClassName?: string
  sequential?: boolean
  speed?: number
  text: string
}

const DEFAULT_CHARS = '0123456789ABCDEF!@#$%^&*~'

/**
 * React Bits - DecryptedText 字符解密动效
 * 文本在初始化或悬停时先以随机乱码高频闪烁，随后平滑收敛为真实文字。
 */
export function DecryptedText({
  animateOn = 'view',
  characters = DEFAULT_CHARS,
  className = '',
  encryptedClassName = 'text-primary/70 font-mono',
  maxIterations = 8,
  parentClassName = '',
  sequential = true,
  speed = 35,
  text,
}: DecryptedTextProps) {
  const [displayText, setDisplayText] = useState(text)
  const [isHovering, setIsHovering] = useState(false)
  const [isScrambling, setIsScrambling] = useState(false)
  const [revealedIndices, setRevealedIndices] = useState<Set<number>>(new Set())
  const containerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>
    let currentIteration = 0

    const startScramble = () => {
      setIsScrambling(true)
      currentIteration = 0
      const newRevealed = new Set<number>()

      interval = setInterval(() => {
        setDisplayText(() => {
          return text
            .split('')
            .map((char, index) => {
              if (char === ' ' || char === '\n' || char === '\t') {
                return char
              }

              if (newRevealed.has(index)) {
                return text[index]
              }

              if (sequential) {
                if (currentIteration >= index * 1.5) {
                  newRevealed.add(index)
                  return text[index]
                }
              } else if (currentIteration >= maxIterations) {
                newRevealed.add(index)
                return text[index]
              }

              const randomIndex = Math.floor(Math.random() * characters.length)
              return characters[randomIndex]
            })
            .join('')
        })

        setRevealedIndices(new Set(newRevealed))
        currentIteration++

        if (newRevealed.size >= text.replace(/\s/g, '').length || currentIteration > text.length * 3) {
          clearInterval(interval)
          setDisplayText(text)
          setIsScrambling(false)
        }
      }, speed)
    }

    if (animateOn === 'view') {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) {
            startScramble()
            observer.disconnect()
          }
        },
        { threshold: 0.1 },
      )

      if (containerRef.current) {
        observer.observe(containerRef.current)
      }

      return () => {
        clearInterval(interval)
        observer.disconnect()
      }
    }

    if (animateOn === 'hover' && isHovering) {
      startScramble()
      return () => clearInterval(interval)
    }

    return () => clearInterval(interval)
  }, [animateOn, characters, isHovering, maxIterations, sequential, speed, text])

  return (
    <span
      className={`inline-block ${parentClassName}`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      ref={containerRef}
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {displayText.split('').map((char, index) => {
          const isRevealed = revealedIndices.has(index) || !isScrambling || char === ' '
          return (
            <span className={isRevealed ? className : encryptedClassName} key={index}>
              {char}
            </span>
          )
        })}
      </span>
    </span>
  )
}
