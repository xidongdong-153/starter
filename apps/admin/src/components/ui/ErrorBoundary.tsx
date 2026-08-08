import type { ErrorComponentProps } from '@tanstack/react-router'

import { Button } from 'antd'
import { AlertTriangle, House, RefreshCw } from 'lucide-react'

import { ErrorStatePage } from './ErrorStatePage'

/**
 * 路由级错误边界，捕获页面渲染和加载异常
 */
export function ErrorBoundary({ error, info, reset }: ErrorComponentProps) {
  const errorMessage = error instanceof Error && error.message.trim() ? error.message : '当前页面出现了未预期的错误'
  const errorName = error instanceof Error && error.name.trim() ? error.name : 'ApplicationError'

  const handleRetry = () => {
    reset()
  }

  const handleGoHome = () => {
    window.location.assign('/')
  }

  return (
    <ErrorStatePage
      eyebrow="Error State"
      icon={<AlertTriangle className="size-5" />}
      title="当前页面暂时无法显示"
      description="页面加载时出了点问题。重试当前页面，或返回首页继续其他操作。"
      note="如果问题一直出现，可以看下面的错误信息。"
      actions={
        <>
          <Button type="primary" icon={<RefreshCw className="size-4" />} onClick={handleRetry}>
            重试
          </Button>
          <Button icon={<House className="size-4" />} onClick={handleGoHome}>
            首页
          </Button>
        </>
      }
      detailDescription="需要排查时，参考下面的错误信息。"
      detailItems={[
        {
          label: '错误名称',
          content: <pre className="overflow-x-auto text-xs leading-6 break-words whitespace-pre-wrap">{errorName}</pre>,
        },
        {
          label: '错误消息',
          content: (
            <pre className="overflow-x-auto text-xs leading-6 break-words whitespace-pre-wrap">{errorMessage}</pre>
          ),
        },
        ...(info?.componentStack
          ? [
              {
                label: '组件堆栈',
                content: (
                  <pre className="text-fg-muted max-h-48 overflow-auto text-xs leading-6 break-words whitespace-pre-wrap">
                    {info.componentStack}
                  </pre>
                ),
              },
            ]
          : []),
      ]}
    />
  )
}
