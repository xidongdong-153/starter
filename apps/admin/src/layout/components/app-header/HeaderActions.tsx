import { ResponsiveTooltip } from '@admin/components/ui'
import { clsx } from 'clsx'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AccountMenuButton, FullscreenButton, LanguageButton, SettingButton, ThemeToggle } from '../../atoms'

function getDefaultActionsExpanded() {
  if (typeof window === 'undefined') {
    return true
  }

  return window.innerWidth >= 1280
}

/**
 * 顶部右侧操作区：全屏、语言、主题、设置和账号
 */
export function HeaderActions() {
  const { t } = useTranslation()
  const [isActionsExpanded, setIsActionsExpanded] = useState(getDefaultActionsExpanded)
  const toggleLabel = isActionsExpanded ? t('tooltip.collapseHeaderActions') : t('tooltip.expandHeaderActions')

  return (
    <div className="text-fg-muted flex items-center gap-x-2 md:gap-x-4">
      <div
        className={clsx(
          'flex items-center overflow-hidden transition-[max-width,opacity] duration-300 ease-out',
          isActionsExpanded ? 'max-w-80 opacity-100 xl:max-w-none' : 'pointer-events-none max-w-0 opacity-0',
        )}
      >
        <div className="flex items-center gap-x-2 pr-1 md:gap-x-4">
          <FullscreenButton />
          <LanguageButton />
          <ThemeToggle />
        </div>
      </div>

      <ResponsiveTooltip title={toggleLabel}>
        <button
          type="button"
          aria-label={toggleLabel}
          onClick={() => setIsActionsExpanded((current) => !current)}
          className="hover:text-primary flex h-8 w-8 cursor-pointer items-center justify-center rounded transition-colors"
        >
          {isActionsExpanded ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
        </button>
      </ResponsiveTooltip>

      <SettingButton />

      <AccountMenuButton />
    </div>
  )
}
