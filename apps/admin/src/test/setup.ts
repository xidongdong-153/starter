import { vi } from 'vitest'

/**
 * jsdom 不实现 matchMedia，而 setting store 在模块初始化时就会读取系统深色偏好，
 * 任何间接 import 到 store 的测试都会在 import 阶段抛错，所以在这里补一个最小实现。
 */
if (!window.matchMedia) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as unknown as typeof window.matchMedia
}

/**
 * Node 22 自带实验性 localStorage，未传 --localstorage-file 时取值为 undefined，
 * 并且盖掉了 jsdom 的实现。zustand persist 会直接调用 setItem，所以补一个内存版。
 */
function createMemoryStorage(): Storage {
  const entries = new Map<string, string>()

  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key)
    },
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
  }
}

if (!window.localStorage) {
  const storage = createMemoryStorage()

  for (const target of [window, globalThis]) {
    Object.defineProperty(target, 'localStorage', {
      configurable: true,
      value: storage,
      writable: true,
    })
  }
}

/**
 * jsdom 不实现 scrollIntoView，TabBar 在 requestAnimationFrame 回调里调它，
 * 抛错会变成无法捕获的异常而不是用例失败，所以补一个空实现。
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}

/**
 * jsdom 不实现 ResizeObserver，Antd Table 的列宽测量依赖它。
 * 缺失时渲染直接抛 ReferenceError，任何含 Table 的页面测试都过不去。
 */
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
