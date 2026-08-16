import dayjs from 'dayjs'

/**
 * 格式化时间，默认 YYYY-MM-DD HH:mm:ss
 */
export function formatDate(date: string | Date, format = 'YYYY-MM-DD HH:mm:ss') {
  return dayjs(date).format(format)
}

/**
 * 格式化相对时间，用于会话列表和消息时间
 */
export function formatRelativeTime(date: string | Date): string {
  const d = new Date(date).getTime()
  if (Number.isNaN(d)) return ''
  const now = Date.now()
  const diff = Math.max(0, now - d)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  return dayjs(date).format('MM-DD HH:mm')
}
