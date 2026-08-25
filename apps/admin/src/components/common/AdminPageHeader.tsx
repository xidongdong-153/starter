import type { ReactNode } from 'react'

import { Button } from 'antd'
import { ArrowLeft } from 'lucide-react'

interface AdminPageHeaderProps {
  backLabel?: string
  description?: string
  onBack?: () => void
  title: ReactNode
}

/**
 * 控制台页面头部。无卡片单行标题，描述与标题同行；
 * 操作按钮与摘要标签统一放在下方的 PageToolbar。
 */
export function AdminPageHeader({ backLabel, description, onBack, title }: AdminPageHeaderProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      {onBack ? (
        <Button type="text" className="-ml-3 self-center px-3" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
          {backLabel}
        </Button>
      ) : null}
      <h1 className="text-fg text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
      {description ? <p className="text-fg-muted min-w-0 truncate text-sm">{description}</p> : null}
    </div>
  )
}
