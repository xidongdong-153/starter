import type { ReactNode } from 'react'
import { memo, useMemo } from 'react'
import { CodeBlock } from './CodeBlock'

interface MarkdownRendererProps {
  content: string
  className?: string
}

type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'strike'; value: string }
  | { type: 'link'; text: string; href: string }

function parseInlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let remaining = text

  // 匹配行内代码、链接、加粗、删除线、斜体
  const inlineRegex =
    /`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|#[^\s)]+)\)|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*/

  while (remaining.length > 0) {
    const match = inlineRegex.exec(remaining)
    if (!match || match.index === undefined) {
      tokens.push({ type: 'text', value: remaining })
      break
    }

    if (match.index > 0) {
      tokens.push({ type: 'text', value: remaining.slice(0, match.index) })
    }

    const fullMatch = match[0]
    if (match[1] !== undefined) {
      // 行内代码: `code`
      tokens.push({ type: 'code', value: match[1] })
    } else if (match[2] !== undefined && match[3] !== undefined) {
      // 链接: [text](url)
      tokens.push({ type: 'link', text: match[2], href: match[3] })
    } else if (match[4] !== undefined) {
      // 加粗: **bold**
      tokens.push({ type: 'bold', value: match[4] })
    } else if (match[5] !== undefined) {
      // 删除线: ~~strike~~
      tokens.push({ type: 'strike', value: match[5] })
    } else if (match[6] !== undefined) {
      // 斜体: *italic*
      tokens.push({ type: 'italic', value: match[6] })
    }

    remaining = remaining.slice(match.index + fullMatch.length)
  }

  return tokens
}

function renderInlineTokens(tokens: InlineToken[], keyPrefix: string): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`
    switch (token.type) {
      case 'code':
        return (
          <code
            key={key}
            className="border-border-subtle/80 bg-surface-muted/90 text-fg rounded-md border px-1.5 py-0.5 font-mono text-[12.5px] font-medium"
          >
            {token.value}
          </code>
        )
      case 'bold':
        return (
          <strong key={key} className="text-fg font-semibold">
            {token.value}
          </strong>
        )
      case 'italic':
        return (
          <em key={key} className="italic">
            {token.value}
          </em>
        )
      case 'strike':
        return (
          <del key={key} className="text-fg-muted line-through">
            {token.value}
          </del>
        )
      case 'link':
        return (
          <a
            key={key}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:text-primary-hover underline underline-offset-3"
          >
            {token.text}
          </a>
        )
      case 'text':
      default:
        return <span key={key}>{token.value}</span>
    }
  })
}

type BlockToken =
  | { type: 'codeblock'; code: string; lang?: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'hr' }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'paragraph'; lines: string[] }

function parseBlocks(markdown: string): BlockToken[] {
  const lines = markdown.split('\n')
  const blocks: BlockToken[] = []
  let i = 0

  while (i < lines.length) {
    const rawLine = lines[i] ?? ''
    const line = rawLine.trim()

    // 1. 处理代码块 ```lang
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i += 1
      while (i < lines.length) {
        const nextLine = lines[i] ?? ''
        if (nextLine.trim().startsWith('```')) {
          i += 1
          break
        }
        codeLines.push(nextLine)
        i += 1
      }
      blocks.push({ type: 'codeblock', code: codeLines.join('\n'), lang: lang || undefined })
      continue
    }

    // 空行跳过
    if (line === '') {
      i += 1
      continue
    }

    // 2. 分割线
    if (/^(?:\*\*\*|---|___)$/.test(line)) {
      blocks.push({ type: 'hr' })
      i += 1
      continue
    }

    // 3. 标题
    const headingPrefix = line.match(/^#{1,6}/)?.[0]
    if (headingPrefix && line.length > headingPrefix.length && line[headingPrefix.length] === ' ') {
      const headingText = line.slice(headingPrefix.length + 1).trim()
      if (headingText) {
        blocks.push({
          type: 'heading',
          level: headingPrefix.length,
          text: headingText,
        })
        i += 1
        continue
      }
    }

    // 4. 引用
    if (line.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length) {
        const qLine = (lines[i] ?? '').trim()
        if (!qLine.startsWith('>')) break
        quoteLines.push(qLine.replace(/^>\s?/, ''))
        i += 1
      }
      blocks.push({ type: 'blockquote', lines: quoteLines })
      continue
    }

    // 5. 无序列表
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length) {
        const l = (lines[i] ?? '').trim()
        if (!/^[-*+]\s+/.test(l)) break
        items.push(l.replace(/^[-*+]\s+/, ''))
        i += 1
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    // 6. 有序列表
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length) {
        const l = (lines[i] ?? '').trim()
        if (!/^\d+\.\s+/.test(l)) break
        items.push(l.replace(/^\d+\.\s+/, ''))
        i += 1
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    // 7. 表格检测 (带 | 的行且下一行为分割线)
    if (line.startsWith('|') && line.endsWith('|') && i + 1 < lines.length) {
      const nextLine = (lines[i + 1] ?? '').trim()
      if (/^\|(?:\s*:?-+:?\s*\|)+$/.test(nextLine)) {
        const parseRow = (r: string) =>
          r
            .slice(1, -1)
            .split('|')
            .map((c) => c.trim())

        const headers = parseRow(line)
        i += 2 // 跳过表头与分割线
        const rows: string[][] = []
        while (i < lines.length) {
          const rowLine = (lines[i] ?? '').trim()
          if (!rowLine.startsWith('|') || !rowLine.endsWith('|')) break
          rows.push(parseRow(rowLine))
          i += 1
        }
        blocks.push({ type: 'table', headers, rows })
        continue
      }
    }

    // 8. 普通段落
    const paraLines: string[] = [rawLine]
    i += 1
    while (i < lines.length) {
      const nextRaw = lines[i] ?? ''
      const nextTrimmed = nextRaw.trim()
      if (
        nextTrimmed === '' ||
        nextTrimmed.startsWith('```') ||
        nextTrimmed.startsWith('#') ||
        nextTrimmed.startsWith('>') ||
        /^[-*+]\s+/.test(nextTrimmed) ||
        /^\d+\.\s+/.test(nextTrimmed) ||
        (nextTrimmed.startsWith('|') && nextTrimmed.endsWith('|'))
      ) {
        break
      }
      paraLines.push(nextRaw)
      i += 1
    }
    blocks.push({ type: 'paragraph', lines: paraLines })
  }

  return blocks
}

export const MarkdownRenderer = memo(({ content, className = '' }: MarkdownRendererProps) => {
  const blocks = useMemo(() => parseBlocks(content), [content])

  return (
    <div className={`space-y-3 text-sm leading-relaxed ${className}`}>
      {blocks.map((block, bIdx) => {
        const key = `b-${bIdx}`

        switch (block.type) {
          case 'codeblock':
            return <CodeBlock key={key} code={block.code} language={block.lang} />

          case 'heading': {
            const inline = parseInlineTokens(block.text)
            if (block.level === 1) {
              return (
                <h1 key={key} className="text-fg m-0 mt-4 mb-2 text-lg font-bold tracking-tight">
                  {renderInlineTokens(inline, key)}
                </h1>
              )
            }
            if (block.level === 2) {
              return (
                <h2 key={key} className="text-fg m-0 mt-3.5 mb-1.5 text-base font-semibold tracking-tight">
                  {renderInlineTokens(inline, key)}
                </h2>
              )
            }
            if (block.level === 3) {
              return (
                <h3 key={key} className="text-fg m-0 mt-3 mb-1 text-sm font-semibold">
                  {renderInlineTokens(inline, key)}
                </h3>
              )
            }
            return (
              <h4 key={key} className="text-fg m-0 mt-2.5 mb-0.5 text-sm font-medium">
                {renderInlineTokens(inline, key)}
              </h4>
            )
          }

          case 'blockquote':
            return (
              <blockquote
                key={key}
                className="border-primary/60 bg-surface-muted/50 text-fg-muted my-2 rounded-r-xl border-l-3 py-2 pr-3 pl-3.5 text-xs italic"
              >
                {block.lines.map((l, lIdx) => (
                  <p key={`${key}-l-${lIdx}`} className="m-0 leading-5">
                    {renderInlineTokens(parseInlineTokens(l), `${key}-l-${lIdx}`)}
                  </p>
                ))}
              </blockquote>
            )

          case 'ul':
            return (
              <ul key={key} className="text-fg m-0 my-2 list-disc space-y-1.5 pl-5 leading-relaxed">
                {block.items.map((item, itemIdx) => (
                  <li key={`${key}-it-${itemIdx}`}>
                    {renderInlineTokens(parseInlineTokens(item), `${key}-it-${itemIdx}`)}
                  </li>
                ))}
              </ul>
            )

          case 'ol':
            return (
              <ol key={key} className="text-fg m-0 my-2 list-decimal space-y-1.5 pl-5 leading-relaxed">
                {block.items.map((item, itemIdx) => (
                  <li key={`${key}-it-${itemIdx}`}>
                    {renderInlineTokens(parseInlineTokens(item), `${key}-it-${itemIdx}`)}
                  </li>
                ))}
              </ol>
            )

          case 'hr':
            return <hr key={key} className="border-border-subtle my-3.5 border-t" />

          case 'table':
            return (
              <div
                key={key}
                className="border-border-subtle chat-scrollbar my-3 overflow-x-auto rounded-xl border shadow-2xs"
              >
                <table className="min-w-full divide-border-subtle divide-y text-left text-xs">
                  <thead className="bg-surface-muted/90 text-fg font-medium">
                    <tr>
                      {block.headers.map((h, hIdx) => (
                        <th key={`${key}-th-${hIdx}`} className="px-3.5 py-2 whitespace-nowrap">
                          {renderInlineTokens(parseInlineTokens(h), `${key}-th-${hIdx}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-border-subtle divide-y bg-surface">
                    {block.rows.map((row, rIdx) => (
                      <tr key={`${key}-r-${rIdx}`} className="hover:bg-surface-muted/40 transition-colors">
                        {row.map((cell, cIdx) => (
                          <td key={`${key}-r-${rIdx}-c-${cIdx}`} className="text-fg px-3.5 py-2 leading-relaxed">
                            {renderInlineTokens(parseInlineTokens(cell), `${key}-r-${rIdx}-c-${cIdx}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )

          case 'paragraph':
          default:
            return (
              <p key={key} className="text-fg m-0 whitespace-pre-wrap break-words leading-relaxed">
                {renderInlineTokens(parseInlineTokens(block.lines.join('\n')), key)}
              </p>
            )
        }
      })}
    </div>
  )
})
