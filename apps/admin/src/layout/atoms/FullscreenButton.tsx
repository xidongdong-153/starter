import { ResponsiveTooltip } from '@admin/components/ui'
import { Fullscreen } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useFullscreen, useToggle } from 'react-use'

interface FullscreenButtonProps {
  className?: string
}

/**
 * 全屏切换
 */
export function FullscreenButton({ className }: FullscreenButtonProps) {
  const { t } = useTranslation()
  const ref = useRef(document.documentElement)
  const [show, toggle] = useToggle(false)
  const isFullscreen = useFullscreen(ref, show, { onClose: () => toggle(false) })
  const label = isFullscreen ? t('theme.exitFullscreen') : t('theme.fullscreen')

  return (
    <ResponsiveTooltip title={label}>
      <button
        type="button"
        aria-label={label}
        onClick={() => toggle()}
        className={`hover:text-primary flex cursor-pointer items-center transition-colors ${
          isFullscreen ? 'text-primary' : ''
        } ${className || ''}`}
      >
        <Fullscreen size={20} />
      </button>
    </ResponsiveTooltip>
  )
}
