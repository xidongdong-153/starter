import type { AdminRouteRecord } from '@admin/app/router/types'

import { lazyRouteComponent } from '@tanstack/react-router'
import { Files } from 'lucide-react'

export const filesRoutes: AdminRouteRecord[] = [
  {
    component: lazyRouteComponent(() => import('./pages/FileList'), 'FileList'),
    icon: Files,
    id: 'files.list',
    layout: {
      contentWidth: 'full',
    },
    menu: {
      group: 'files',
      order: 10,
    },
    path: '/files',
    title: 'menu.fileList',
  },
]
