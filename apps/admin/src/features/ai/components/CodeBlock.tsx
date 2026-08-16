import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface CodeBlockProps {
  code: string
  language?: string
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(setCopied, 2000, false)
    } catch {
      // 剪贴板不可用时静默降级
    }
  }

  const displayLang = language?.trim().toLowerCase() || 'text'

  return (
    <div className="border-border-subtle my-3 overflow-hidden rounded-xl border bg-surface-muted/60 text-xs shadow-2xs">
      <div className="border-border-subtle/80 bg-surface-muted/90 flex items-center justify-between border-b px-3.5 py-1.5 backdrop-blur-xs">
        <span className="text-fg-muted font-mono text-[11px] font-medium tracking-wider uppercase">{displayLang}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label={t('ai.conversations.copyCode')}
          className="text-fg-muted hover:text-fg hover:bg-surface-elevated/70 active:scale-95 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 transition-all duration-150"
        >
          {copied ? (
            <>
              <Check className="text-success size-3.5" />
              <span className="text-success font-sans text-xs">{t('ai.conversations.copySuccess')}</span>
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              <span className="font-sans text-xs">{t('ai.conversations.copyCode')}</span>
            </>
          )}
        </button>
      </div>
      <div className="chat-scrollbar overflow-x-auto p-3.5 pt-3 pb-3.5 font-mono text-[13px] leading-6 selection:bg-primary/20">
        <pre className="text-fg m-0 whitespace-pre font-mono">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  )
}
