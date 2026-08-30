'use client'

import { Check, Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { cn } from '@web/lib/utils'

interface ChatMarkdownProps {
  content: string
  className?: string
}

/**
 * 轻量安全 Markdown 解析与排版渲染：
 * 支持标题（#~###）、引用（>）、无序列表（- / *）、有序列表（1.）、
 * 代码块（```lang ... ```）、行内代码（`code`）、粗体（**text**）、斜体（*text*）。
 * 纯 React DOM 构建，杜绝 XSS 风险。
 */
export function ChatMarkdown({ content, className }: ChatMarkdownProps) {
  if (!content) return null

  const blocks = parseMarkdownBlocks(content)

  return (
    <div className={cn('space-y-3 leading-relaxed break-words text-foreground', className)}>
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  )
}

interface MarkdownBlock {
  type: 'heading' | 'code' | 'blockquote' | 'ul' | 'ol' | 'paragraph'
  level?: number
  lang?: string
  content: string
  items?: string[]
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.split('\n')
  const blocks: MarkdownBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''

    // Fenced Code Block: ```lang
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i]?.trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '')
        i++
      }
      if (i < lines.length) i++ // skip closing ```
      blocks.push({
        type: 'code',
        lang: lang || 'plaintext',
        content: codeLines.join('\n'),
      })
      continue
    }

    // Heading: #, ##, ###
    if (line.startsWith('#')) {
      const headingMatch = line.match(/^(#{1,3})\s/)
      if (headingMatch && headingMatch[1]) {
        const level = headingMatch[1].length
        const headingContent = line.slice(level).trim()
        if (headingContent.length > 0) {
          blocks.push({
            type: 'heading',
            level,
            content: headingContent,
          })
          i++
          continue
        }
      }
    }

    // Blockquote: >
    if (line.startsWith('>')) {
      const quoteLines: string[] = []
      while (
        i < lines.length &&
        (lines[i]?.startsWith('>') || (lines[i]?.trim() !== '' && !isBlockStarter(lines[i] ?? '')))
      ) {
        const quoteLine = lines[i]?.replace(/^>\s?/, '') ?? ''
        quoteLines.push(quoteLine)
        i++
      }
      blocks.push({
        type: 'blockquote',
        content: quoteLines.join('\n'),
      })
      continue
    }

    // Unordered list: - or *
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        const itemText = (lines[i] ?? '').replace(/^\s*[-*]\s+/, '')
        items.push(itemText)
        i++
      }
      blocks.push({
        type: 'ul',
        content: '',
        items,
      })
      continue
    }

    // Ordered list: 1.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        const itemText = (lines[i] ?? '').replace(/^\s*\d+\.\s+/, '')
        items.push(itemText)
        i++
      }
      blocks.push({
        type: 'ol',
        content: '',
        items,
      })
      continue
    }

    // 空行跳过
    if (line.trim() === '') {
      i++
      continue
    }

    // Regular paragraph
    const pLines: string[] = []
    while (i < lines.length && lines[i]?.trim() !== '' && !isBlockStarter(lines[i] ?? '')) {
      pLines.push(lines[i] ?? '')
      i++
    }
    blocks.push({
      type: 'paragraph',
      content: pLines.join('\n'),
    })
  }

  return blocks
}

function isBlockStarter(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed.startsWith('```') ||
    /^#{1,3}\s+/.test(trimmed) ||
    trimmed.startsWith('>') ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed)
  )
}

function renderBlock(block: MarkdownBlock, key: number): ReactNode {
  switch (block.type) {
    case 'code':
      return <CodeBlock content={block.content} key={key} lang={block.lang ?? 'plaintext'} />
    case 'heading': {
      if (block.level === 1) {
        return (
          <h2 className="mt-4 text-base font-bold text-foreground first:mt-0" key={key}>
            {renderInline(block.content)}
          </h2>
        )
      }
      if (block.level === 2) {
        return (
          <h3 className="mt-3 text-sm font-semibold text-foreground first:mt-0" key={key}>
            {renderInline(block.content)}
          </h3>
        )
      }
      return (
        <h4 className="mt-2.5 text-xs font-semibold text-foreground first:mt-0" key={key}>
          {renderInline(block.content)}
        </h4>
      )
    }
    case 'blockquote':
      return (
        <blockquote
          className="border-l-2 border-primary/60 bg-surface-muted/40 px-3 py-1.5 text-xs text-muted-foreground italic"
          key={key}
        >
          {renderInline(block.content)}
        </blockquote>
      )
    case 'ul':
      return (
        <ul className="list-disc space-y-1 pl-5 text-xs text-foreground" key={key}>
          {block.items?.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol className="list-decimal space-y-1 pl-5 text-xs text-foreground" key={key}>
          {block.items?.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      )
    case 'paragraph':
    default:
      return (
        <p className="text-xs leading-6 text-foreground whitespace-pre-wrap" key={key}>
          {renderInline(block.content)}
        </p>
      )
  }
}

/**
 * 行内元素解析（粗体、斜体、行内代码）
 */
function renderInline(text: string): ReactNode {
  // 分割标记：`code` 或 **bold** 或 *italic*
  const parts: ReactNode[] = []
  let remaining = text
  let keyIndex = 0

  while (remaining.length > 0) {
    // 匹配行内代码 `code`
    const codeMatch = remaining.match(/`([^`]+)`/)
    // 匹配粗体 **bold**
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/)
    // 匹配斜体 *italic*
    const italicMatch = remaining.match(/(?<!\*)\*([^*]+)\*(?!\*)/)

    // 找到最靠前的匹配项
    type MatchInfo = { index: number; length: number; node: ReactNode }
    const matches: MatchInfo[] = []

    if (codeMatch && codeMatch.index !== undefined) {
      matches.push({
        index: codeMatch.index,
        length: codeMatch[0].length,
        node: (
          <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-primary" key={keyIndex++}>
            {codeMatch[1]}
          </code>
        ),
      })
    }

    if (boldMatch && boldMatch.index !== undefined) {
      matches.push({
        index: boldMatch.index,
        length: boldMatch[0].length,
        node: (
          <strong className="font-semibold text-foreground" key={keyIndex++}>
            {boldMatch[1]}
          </strong>
        ),
      })
    }

    if (italicMatch && italicMatch.index !== undefined) {
      matches.push({
        index: italicMatch.index,
        length: italicMatch[0].length,
        node: (
          <em className="italic text-foreground/90" key={keyIndex++}>
            {italicMatch[1]}
          </em>
        ),
      })
    }

    if (matches.length === 0) {
      parts.push(remaining)
      break
    }

    matches.sort((a, b) => a.index - b.index)
    const firstMatch = matches[0]
    if (!firstMatch) {
      parts.push(remaining)
      break
    }

    if (firstMatch.index > 0) {
      parts.push(remaining.slice(0, firstMatch.index))
    }

    parts.push(firstMatch.node)
    remaining = remaining.slice(firstMatch.index + firstMatch.length)
  }

  return parts
}

interface CodeBlockProps {
  content: string
  lang: string
}

function CodeBlock({ content, lang }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(setCopied, 2000, false)
    } catch {
      // 忽略无法复制的剪贴板异常
    }
  }

  return (
    <div className="relative my-2.5 overflow-hidden rounded border border-border-subtle bg-surface-muted/80 shadow-xs">
      <div className="flex items-center justify-between border-b border-border-subtle/60 bg-surface/90 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono font-medium lowercase">{lang}</span>
        <button
          aria-label={copied ? '已复制代码' : '复制代码'}
          className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          onClick={handleCopy}
          type="button"
        >
          {copied ? (
            <>
              <Check aria-hidden="true" className="text-success" size={12} />
              <span className="text-success">已复制</span>
            </>
          ) : (
            <>
              <Copy aria-hidden="true" size={12} />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-foreground">
        <code>{content}</code>
      </pre>
    </div>
  )
}
