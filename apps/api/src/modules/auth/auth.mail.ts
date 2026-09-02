import type { MailMessage } from '@api/infra/mail/index.js'

interface AuthMailInput {
  link: string
  name: string
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  )
}

export type AuthMailBody = Omit<MailMessage, 'to'>

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

const BG = '#faf4ed' // Rose Pine Dawn base
const SURFACE = '#fffaf3' // Rose Pine Dawn surface
const BORDER = '#f2e9e1' // Rose Pine Dawn overlay
const TEXT = '#575279' // Rose Pine Dawn text
const MUTED = '#9893a5' // Rose Pine Dawn muted
const ACCENT = '#b4637a' // Rose Pine Dawn love
const LINK = '#286983' // Rose Pine Dawn pine

interface MailShellParts {
  preheader: string
  subject: string
  title: string
  paragraphs: string[]
  ctaText: string
  ctaUrl: string
  note: string
}

/**
 * 邮件 HTML 外壳：Rose Pine Dawn 浅色版式。
 * table 布局 + 全内联样式，兼容 Gmail / Outlook / Apple Mail；
 * 按钮下方附完整链接，防止邮件客户端屏蔽按钮。
 */
function renderShell({ preheader, subject, title, paragraphs, ctaText, ctaUrl, note }: MailShellParts): string {
  const safeCtaUrl = escapeHtml(ctaUrl)
  const paragraphsHtml = paragraphs
    .map(
      (paragraph) =>
        `<p style="margin: 0 0 14px; font-size: 15px; line-height: 24px; color: ${TEXT};">${escapeHtml(paragraph)}</p>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background: ${BG};">
  <div style="display: none; font-size: 1px; line-height: 1px; max-height: 0; max-width: 0; opacity: 0; overflow: hidden; mso-hide: all;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${BG}; padding: 32px 16px;">
    <tr>
      <td align="center" style="font-family: ${FONT_STACK};">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 600px; background: ${SURFACE}; border: 1px solid ${BORDER}; border-radius: 12px;">
          <tr>
            <td bgcolor="${ACCENT}" style="height: 4px; font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding: 24px 40px 18px; border-bottom: 1px solid ${BORDER};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size: 14px; font-weight: 700; letter-spacing: 1px; color: ${TEXT};">Starter</td>
                  <td align="right"><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${ACCENT}; font-size: 0; line-height: 0;">&nbsp;</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 40px 0;">
              <h1 style="margin: 0 0 20px; font-size: 22px; font-weight: 700; line-height: 30px; color: ${TEXT};">${escapeHtml(title)}</h1>
              ${paragraphsHtml}
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px 0 22px;">
                <tr>
                  <td bgcolor="${ACCENT}" style="border-radius: 8px;">
                    <a href="${safeCtaUrl}" style="display: inline-block; padding: 12px 28px; border-radius: 8px; background: ${ACCENT}; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; line-height: 1.2;">${escapeHtml(ctaText)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 6px; font-size: 13px; line-height: 20px; color: ${MUTED};">如果按钮打不开，把下面的链接复制到浏览器：</p>
              <p style="margin: 0 0 8px; font-size: 13px; line-height: 20px;"><a href="${safeCtaUrl}" style="color: ${LINK}; text-decoration: underline; word-break: break-all;">${safeCtaUrl}</a></p>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 40px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top: 1px solid ${BORDER};">
                <tr>
                  <td style="padding: 18px 0 0;">
                    <p style="margin: 0; font-size: 13px; line-height: 20px; color: ${MUTED};">${escapeHtml(note)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 40px 24px; background: ${BG}; border-top: 1px solid ${BORDER};">
              <p style="margin: 0; font-size: 12px; line-height: 18px; color: ${MUTED};">这是 Starter 自动发送的邮件，请勿直接回复。</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * 验证邮件。link 指向 Admin 的 /verify-email?token= 页面，token 有效期 1 小时。
 */
export function buildVerificationEmail({ link, name }: AuthMailInput): AuthMailBody {
  const subject = '验证你的 Starter 邮箱'
  const greeting = name ? `${name}，你好。` : '你好。'
  const text = [
    `${greeting}你刚用这个邮箱注册了 Starter 账号。`,
    '',
    '点下面的链接验证邮箱：',
    link,
    '',
    '链接 1 小时内有效。如果不是你注册的账号，忽略这封邮件即可。',
  ].join('\n')
  const html = renderShell({
    preheader: '验证你的 Starter 邮箱，确认邮箱归你所有。',
    subject,
    title: '验证你的邮箱',
    paragraphs: [`${greeting}你刚用这个邮箱注册了 Starter 账号。`, '点下面的按钮验证邮箱，确认这个邮箱归你所有。'],
    ctaText: '验证邮箱',
    ctaUrl: link,
    note: '链接 1 小时内有效。如果不是你注册的账号，忽略这封邮件即可。',
  })

  return { subject, text, html }
}

/**
 * 重置密码邮件。link 指向 Admin 的 /reset-password?token= 页面，token 有效期 1 小时。
 */
export function buildResetPasswordEmail({ link, name }: AuthMailInput): AuthMailBody {
  const subject = '重置你的 Starter 密码'
  const greeting = name ? `${name}，你好。` : '你好。'
  const text = [
    `${greeting}你刚发起了密码重置。`,
    '',
    '点下面的链接设置新密码：',
    link,
    '',
    '链接 1 小时内有效。如果不是你发起的重置，忽略这封邮件，你的原密码仍然有效。',
  ].join('\n')
  const html = renderShell({
    preheader: '为你的 Starter 账号设置新密码。',
    subject,
    title: '重置你的密码',
    paragraphs: [`${greeting}你刚发起了密码重置。`, '点下面的按钮，去设置一个新密码。'],
    ctaText: '设置新密码',
    ctaUrl: link,
    note: '链接 1 小时内有效。如果不是你发起的重置，忽略这封邮件，你的原密码仍然有效。',
  })

  return { subject, text, html }
}
