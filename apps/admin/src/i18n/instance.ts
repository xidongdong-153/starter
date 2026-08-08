import i18n from './index'

/**
 * i18n 实例访问器，避免循环依赖
 */
export const getI18nInstance = () => i18n
