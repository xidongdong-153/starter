import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENCRYPTION_VERSION = "v1";
const IV_BYTES = 12;
const SECRET_BYTES = 32;

export class WebhookCryptoKeyUnavailableError extends Error {
  constructor() {
    super("AI webhook encryption key is unavailable");
    this.name = "WebhookCryptoKeyUnavailableError";
  }
}

export class WebhookCryptoDecryptError extends Error {
  constructor() {
    super("AI webhook signing secret cannot be decrypted");
    this.name = "WebhookCryptoDecryptError";
  }
}

export interface WebhookCrypto {
  readonly available: boolean;
  /** 返回 `v1.<iv>.<tag>.<ciphertext>`，三段都是 base64url。 */
  encryptSecret: (plain: string) => string;
  decryptSecret: (payload: string) => string;
}

/**
 * Webhook signing secret 的 AES-256-GCM 加解密。
 *
 * key 与 Provider 凭据共用 `AI_CREDENTIAL_ENCRYPTION_KEY`，但存储格式独立：
 * 单列字符串 `v1.<iv>.<tag>.<ciphertext>`，不与 ai_provider_configs 的四列结构混用。
 */
export function createWebhookCrypto(
  encodedKey: string | undefined,
): WebhookCrypto {
  const key = encodedKey ? Buffer.from(encodedKey, "base64") : undefined;
  const usable = key?.byteLength === 32;

  return {
    available: usable,
    encryptSecret(plain: string): string {
      if (!usable) throw new WebhookCryptoKeyUnavailableError();
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(Buffer.from(plain, "utf8")),
        cipher.final(),
      ]);
      return [
        ENCRYPTION_VERSION,
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(".");
    },
    decryptSecret(payload: string): string {
      if (!usable) throw new WebhookCryptoKeyUnavailableError();
      const parts = payload.split(".");
      if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION)
        throw new WebhookCryptoDecryptError();
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(parts[1]!, "base64url"),
        );
        decipher.setAuthTag(Buffer.from(parts[2]!, "base64url"));
        return Buffer.concat([
          decipher.update(Buffer.from(parts[3]!, "base64url")),
          decipher.final(),
        ]).toString("utf8");
      } catch (error) {
        if (error instanceof WebhookCryptoKeyUnavailableError) throw error;
        throw new WebhookCryptoDecryptError();
      }
    },
  };
}

/** 生成 `wh_` 前缀的 signing secret，明文只在创建/rotate 响应、test 探测和签名时出现。 */
export function createWebhookSigningSecret(): string {
  return `wh_${randomBytes(SECRET_BYTES).toString("base64url")}`;
}
