import { NOOP_TELEMETRY_CONTEXT } from '@earendil-works/pi-telemetry'
import type {
  SpanAttributes,
  SpanOptions,
  SpanStatus,
  TelemetryContext,
  TelemetrySpan,
} from '@earendil-works/pi-telemetry'

import type { AiSpanEndAttributes, AiSpanName, AiSpanStartAttributes } from './ai-telemetry.schema.js'

export type AiTelemetryOperation = 'start_span' | 'set_attributes' | 'set_status' | 'add_event'

export interface AiTelemetryFailure {
  operation: AiTelemetryOperation
  span: string
}

/** span 上下文，只用于创建子 span，不承载业务状态。 */
export type AiTelemetryTarget = TelemetryContext

export interface AiSpan<Name extends AiSpanName> extends AiTelemetryTarget {
  setAttributes: (attributes: AiSpanEndAttributes<Name>) => void
  setStatus: (status: SpanStatus) => void
}

/**
 * 由事件边界关闭的 span 作用域。
 *
 * Turn 和 assistant Step 的开始/结束来自 Pi 事件流，没有单个可 await 的调用，
 * 所以这里让 span callback 等一个内部 promise，`close` 触发后 span 才结束；
 * span 句柄始终留在 callback 作用域内，不额外暴露 `end()`。
 */
export interface AiSpanScope<Name extends AiSpanName> {
  readonly span: AiSpan<Name>
  readonly close: (input?: { attributes?: AiSpanEndAttributes<Name>; status?: SpanStatus }) => void
}

/**
 * 包一层隔离层：telemetry 自身抛错只写安全日志，不改变业务执行。
 *
 * - `startSpan` 抛错时业务 callback 仍然执行且只执行一次。
 * - 返回的 promise 始终是业务 callback 的结果，不是 adapter 的 promise。
 * - `setAttributes`、`setStatus`、`addEvent` 抛错被吞掉。
 */
export function createAiTelemetryContext(
  context: TelemetryContext = NOOP_TELEMETRY_CONTEXT,
  options: { onFailure?: (failure: AiTelemetryFailure) => void } = {},
): TelemetryContext {
  const report = (operation: AiTelemetryOperation, span: string): void => {
    try {
      options.onFailure?.({ operation, span })
    } catch {
      // 失败回调本身不能影响业务执行。
    }
  }
  return {
    startSpan: (spanOptions, callback) => safeStartSpan(context, spanOptions, callback, report),
  }
}

type FailureReporter = (operation: AiTelemetryOperation, span: string) => void

function safeStartSpan<T>(
  context: TelemetryContext,
  options: SpanOptions,
  callback: (span: TelemetrySpan) => T | Promise<T>,
  report: FailureReporter,
): Promise<T> {
  let business: Promise<T> | undefined
  const invoke = (span: TelemetrySpan | undefined): Promise<T> => {
    // adapter 重复调用或提前抛错时，业务 callback 只执行一次。
    business ??= (async () => callback(span ? wrapSpan(span, options.name, report) : inertSpan()))()
    return business
  }
  try {
    const settled = context.startSpan(options, (span) => invoke(span))
    void Promise.resolve(settled).catch((error: unknown) => {
      // adapter 会把业务异常原样 reject 回来，只有其他异常算 telemetry 故障。
      if (!business) {
        report('start_span', options.name)
        return
      }
      void business.then(
        () => report('start_span', options.name),
        (businessError: unknown) => {
          if (businessError !== error) report('start_span', options.name)
        },
      )
    })
  } catch {
    report('start_span', options.name)
  }
  return invoke(undefined)
}

function wrapSpan(span: TelemetrySpan, name: string, report: FailureReporter): TelemetrySpan {
  return {
    startSpan: (options, callback) => safeStartSpan(span, options, callback, report),
    setAttributes(attributes) {
      try {
        span.setAttributes(attributes)
      } catch {
        report('set_attributes', name)
      }
    },
    setStatus(status) {
      try {
        span.setStatus(status)
      } catch {
        report('set_status', name)
      }
    },
    addEvent(eventName, attributes) {
      try {
        span.addEvent(eventName, attributes)
      } catch {
        report('add_event', name)
      }
    },
  }
}

/** adapter 完全不可用时的惰性 span：子 span 的业务 callback 仍然执行。 */
function inertSpan(): TelemetrySpan {
  const span: TelemetrySpan = {
    startSpan: (_options, callback) => (async () => callback(span))(),
    setAttributes: () => undefined,
    setStatus: () => undefined,
    addEvent: () => undefined,
  }
  return span
}

/** 在 callback 作用域内创建一个 Starter AI span。 */
export function startAiSpan<Name extends AiSpanName, T>(
  parent: AiTelemetryTarget,
  name: Name,
  attributes: AiSpanStartAttributes<Name>,
  callback: (span: AiSpan<Name>) => T | Promise<T>,
): Promise<T> {
  return parent.startSpan({ name, attributes: attributes as SpanAttributes }, (span) => callback(span as AiSpan<Name>))
}

/** 打开一个由 `close` 结束的 span 作用域，用于事件驱动的 Run、Turn 和 Step。 */
export function openAiSpanScope<Name extends AiSpanName>(
  parent: AiTelemetryTarget,
  name: Name,
  attributes: AiSpanStartAttributes<Name>,
): AiSpanScope<Name> {
  let finish: (() => void) | undefined
  let captured: AiSpan<Name> | undefined
  const finished = new Promise<void>((resolve) => {
    finish = resolve
  })
  void startAiSpan(parent, name, attributes, async (span) => {
    captured = span
    await finished
  }).catch(() => undefined)
  // 隔离层保证 callback 同步执行；adapter 不合规时退回惰性 span。
  const span = captured ?? (inertSpan() as AiSpan<Name>)
  let closed = false
  return {
    span,
    close(input) {
      if (closed) return
      closed = true
      if (input?.attributes) span.setAttributes(input.attributes)
      if (input?.status) span.setStatus(input.status)
      finish?.()
    },
  }
}
