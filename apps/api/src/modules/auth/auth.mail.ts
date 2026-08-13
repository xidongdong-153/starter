import type { MailMessage } from "@api/infra/mail/index.js";

interface AuthMailInput {
  link: string;
  name: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

export type AuthMailBody = Omit<MailMessage, "to">;

/**
 * 验证邮件。link 指向 Admin 的 /verify-email?token= 页面，token 有效期 1 小时。
 */
export function buildVerificationEmail({
  link,
  name,
}: AuthMailInput): AuthMailBody {
  const subject = "验证你的 Starter 邮箱";
  const safeLink = escapeHtml(link);
  const text = [
    `${name}，你好：`,
    "",
    "验证你的 Starter 账号邮箱：",
    link,
    "",
    "链接 1 小时内有效。如果不是你注册的账号，忽略这封邮件即可。",
  ].join("\n");
  const html = [
    "<p>你好：</p>",
    "<p>验证你的 Starter 账号邮箱：</p>",
    `<p><a href="${safeLink}">${safeLink}</a></p>`,
    "<p>链接 1 小时内有效。如果不是你注册的账号，忽略这封邮件即可。</p>",
  ].join("");

  return { subject, text, html };
}

/**
 * 重置密码邮件。link 指向 Admin 的 /reset-password?token= 页面，token 有效期 1 小时。
 */
export function buildResetPasswordEmail({
  link,
  name,
}: AuthMailInput): AuthMailBody {
  const subject = "重置你的 Starter 密码";
  const safeLink = escapeHtml(link);
  const text = [
    `${name}，你好：`,
    "",
    "点击下面的链接设置新密码：",
    link,
    "",
    "链接 1 小时内有效。如果不是你发起的重置，忽略这封邮件即可。",
  ].join("\n");
  const html = [
    "<p>你好：</p>",
    "<p>点击下面的链接设置新密码：</p>",
    `<p><a href="${safeLink}">${safeLink}</a></p>`,
    "<p>链接 1 小时内有效。如果不是你发起的重置，忽略这封邮件即可。</p>",
  ].join("");

  return { subject, text, html };
}
