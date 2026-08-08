import type { TooltipProps } from 'antd'
import type { ReactElement } from 'react'

import { useMobile } from '@admin/hooks/useMobile'
import { Tooltip } from 'antd'

interface ResponsiveTooltipProps {
  align?: TooltipProps['align']
  arrow?: TooltipProps['arrow']
  autoAdjustOverflow?: TooltipProps['autoAdjustOverflow']
  children: ReactElement
  color?: TooltipProps['color']
  mouseEnterDelay?: TooltipProps['mouseEnterDelay']
  mouseLeaveDelay?: TooltipProps['mouseLeaveDelay']
  overlayClassName?: TooltipProps['overlayClassName']
  overlayStyle?: TooltipProps['overlayStyle']
  placement?: TooltipProps['placement']
  title?: TooltipProps['title']
  trigger?: TooltipProps['trigger']
  zIndex?: TooltipProps['zIndex']
}

/**
 * 移动端不显示 Tooltip，避免点一下才出提示
 */
export function ResponsiveTooltip({ children, ...props }: ResponsiveTooltipProps) {
  const isMobile = useMobile()

  if (isMobile) {
    return children
  }

  return <Tooltip {...props}>{children}</Tooltip>
}
