import { useEffect, useState } from 'react'

/**
 * 判断当前是否移动端。综合屏幕宽度、UA 和触摸支持。
 */
export function useMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    let rafId = 0

    const getIsMobile = () => {
      const screenWidth = window.innerWidth <= 768
      const userAgent = navigator.userAgent.toLowerCase()
      const mobileKeywords = ['android', 'webos', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone', 'mobile']
      const isMobileUA = mobileKeywords.some((keyword) => userAgent.includes(keyword))
      const hasTouchSupport = 'ontouchstart' in window || navigator.maxTouchPoints > 0

      return screenWidth || isMobileUA || (hasTouchSupport && window.innerWidth <= 1024)
    }

    const checkMobile = () => {
      const mobile = getIsMobile()
      setIsMobile((current) => (current === mobile ? current : mobile))
    }

    checkMobile()

    const requestCheckMobile = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(checkMobile)
    }

    window.addEventListener('resize', requestCheckMobile)

    return () => {
      window.removeEventListener('resize', requestCheckMobile)
      cancelAnimationFrame(rafId)
    }
  }, [])

  return isMobile
}
