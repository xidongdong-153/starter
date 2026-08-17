import i18n from '@admin/i18n'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(async () => {
  await i18n.changeLanguage('zh')
})

describe('i18n HTML language', () => {
  it('同步中英文界面的 HTML lang 属性', async () => {
    await i18n.changeLanguage('en')
    expect(document.documentElement.lang).toBe('en')

    await i18n.changeLanguage('zh')
    expect(document.documentElement.lang).toBe('zh-CN')
  })
})
