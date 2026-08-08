import type { BreadcrumbItemType } from 'antd/es/breadcrumb/Breadcrumb'

import { resolveRouteMeta } from '@admin/app/router/types'
import { Link, useMatches } from '@tanstack/react-router'
import { Breadcrumb as AntBreadcrumb } from 'antd'
import { useTranslation } from 'react-i18next'

/**
 * 按当前路由生成面包屑
 */
export function Breadcrumb() {
  const matches = useMatches()
  const { t } = useTranslation()

  const validMatches = matches.filter((match) => {
    const meta = resolveRouteMeta(match.staticData)

    return Boolean(meta.title) && match.pathname !== '/'
  })

  const breadcrumbItems: BreadcrumbItemType[] = validMatches.map((match, index) => {
    const meta = resolveRouteMeta(match.staticData)
    const title = meta.title || 'common.loadingTitle'
    const isLast = index === validMatches.length - 1

    return {
      key: match.pathname,
      title: isLast ? (
        <span className="text-fg-muted">{t(title)}</span>
      ) : (
        <Link to={match.pathname} className="hover:text-primary transition-colors">
          {t(title)}
        </Link>
      ),
    }
  })

  if (breadcrumbItems.length <= 1) {
    return null
  }

  return <AntBreadcrumb items={breadcrumbItems} separator="/" className="text-sm md:hidden lg:block" />
}
