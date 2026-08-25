import type { ReactNode } from 'react'

interface PageToolbarSummaryItem {
  label: string
  value: ReactNode
}

interface PageToolbarProps {
  actions?: ReactNode
  filters?: ReactNode
  summaryItems?: PageToolbarSummaryItem[]
}

/**
 * 表格上方的统一工具栏：左侧放筛选控件与摘要标签，右侧放操作按钮。
 * 三个 prop 全部为空时不渲染，避免出现空工具栏。
 */
export function PageToolbar({ actions, filters, summaryItems = [] }: PageToolbarProps) {
  if (!actions && !filters && summaryItems.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {filters}
        {summaryItems.map((item) => (
          <span
            key={item.label}
            className="border-border-subtle bg-overlay-0/16 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
          >
            <span className="text-fg-muted">{item.label}</span>
            <span className="text-fg font-medium">{item.value}</span>
          </span>
        ))}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
