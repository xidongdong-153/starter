import type { Transporter } from "nodemailer";
import type { Logger } from "pino";
import type { AppEnv } from "@api/shared/env.js";
import nodemailer from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  sendMail: (message: MailMessage) => Promise<void>;
}

/**
 * 日志模式：不配置 SMTP 时把邮件内容打到日志，本地开发可以直接读到。
 */
class LogMailer implements Mailer {
  constructor(private readonly logger: Logger) {}

  sendMail(message: MailMessage): Promise<void> {
    this.logger.info(
      { event: "mail.log", to: message.to, subject: message.subject },
      `[mail] ${message.subject}\n${message.text}`,
    );
    return Promise.resolve();
  }
}

/**
 * SMTP 模式：通过 nodemailer 真实发送。465 端口走 SSL，其余走 STARTTLS。
 */
class SmtpMailer implements Mailer {
  constructor(
    private readonly transport: Transporter,
    private readonly from: string,
  ) {}

  sendMail(message: MailMessage): Promise<void> {
    return this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

export function createMailer(env: AppEnv, logger: Logger): Mailer {
  if (!env.SMTP_HOST) {
    return new LogMailer(logger);
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  });

  return new SmtpMailer(transport, env.SMTP_FROM);
}
