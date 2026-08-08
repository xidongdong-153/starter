import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en'
import zh from './locales/zh'

const LANGUAGE_STORAGE_KEY = 'i18n-language'

/**
 * 取初始语言：先看 localStorage，再看浏览器语言
 */
function getInitialLanguage(): string {
  if (typeof window !== 'undefined') {
    const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (savedLanguage && ['zh', 'en'].includes(savedLanguage)) {
      return savedLanguage
    }

    if (navigator.language.toLowerCase().startsWith('zh')) {
      return 'zh'
    }
  }

  return 'zh'
}

void i18n.use(initReactI18next).init({
  debug: import.meta.env.DEV,
  fallbackLng: 'zh',
  interpolation: {
    escapeValue: false,
  },
  lng: getInitialLanguage(),
  resources: {
    en: {
      translation: en,
    },
    zh: {
      translation: zh,
    },
  },
})

i18n.on('languageChanged', (lng) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng)
  }
})

export default i18n
