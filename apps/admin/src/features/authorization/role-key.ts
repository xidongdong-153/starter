import { roleKeySchema } from '@starter/contracts'

/**
 * 根据角色名称生成 role key 建议值。
 *
 * 规则：trim、转小写、NFKD 规范化去掉拉丁组合音标，
 * 非 ASCII 字母数字转成 `-`，合并连续分隔符并去掉首尾分隔符。
 * 结果必须通过 roleKeySchema（小写字母开头，最长 64）；不通过时返回空字符串，
 * 由管理员自己填写。不做中文拼音转换。
 */
export function suggestRoleKey(name: string): string {
  const candidate = name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return roleKeySchema.safeParse(candidate).success ? candidate : ''
}

/** 手动修改 key 后返回 null，名称变化不再覆盖当前输入。 */
export function resolveRoleKeySuggestion(name: string, keyTouched: boolean): string | null {
  return keyTouched ? null : suggestRoleKey(name)
}

/** 比较两个 key 集合，返回新增和移除项，各自排序。 */
export function diffKeys(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  return {
    added: [...afterSet].filter((key) => !beforeSet.has(key)).sort(),
    removed: [...beforeSet].filter((key) => !afterSet.has(key)).sort(),
  }
}
