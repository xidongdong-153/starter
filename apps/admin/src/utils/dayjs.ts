import dayjs from 'dayjs'

/**
 * 格式化时间，默认 YYYY-MM-DD HH:mm:ss
 */
export function formatDate(date: string | Date, format = 'YYYY-MM-DD HH:mm:ss') {
  return dayjs(date).format(format)
}
