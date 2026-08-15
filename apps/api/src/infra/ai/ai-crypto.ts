import type { Credential } from "@earendil-works/pi-ai";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENCRYPTION_VERSION = 1;

export interface AiEncryptedPayload {
  credential?: Credential;
  runtimeSettings: Record<string, string>;
}

export interface AiEncryptedColumns {
  payloadCiphertext: string;
  payloadIv: string;
  payloadAuthTag: string;
  encryptionVersion: number;
}

export class AiCredentialKeyUnavailableError extends Error {
  constructor() {
    super("AI credential encryption key is unavailable");
    this.name = "AiCredentialKeyUnavailableError";
  }
}

export class AiCredentialDecryptError extends Error {
  constructor() {
    super("AI credential payload cannot be decrypted");
    this.name = "AiCredentialDecryptError";
  }
}

export interface AiCrypto {
  readonly available: boolean;
  decrypt: (columns: AiEncryptedColumns) => AiEncryptedPayload;
  encrypt: (payload: AiEncryptedPayload) => AiEncryptedColumns;
}

export function createAiCrypto(encodedKey: string | undefined): AiCrypto {
  const key = encodedKey ? Buffer.from(encodedKey, "base64") : undefined;

  return {
    available: key?.byteLength === 32,
    encrypt(payload) {
      if (!key || key.byteLength !== 32)
        throw new AiCredentialKeyUnavailableError();

      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const plaintext = Buffer.from(
        JSON.stringify(projectPayload(payload)),
        "utf8",
      );
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);

      return {
        payloadCiphertext: ciphertext.toString("base64"),
        payloadIv: iv.toString("base64"),
        payloadAuthTag: cipher.getAuthTag().toString("base64"),
        encryptionVersion: ENCRYPTION_VERSION,
      };
    },
    decrypt(columns) {
      if (!key || key.byteLength !== 32)
        throw new AiCredentialKeyUnavailableError();
      if (columns.encryptionVersion !== ENCRYPTION_VERSION)
        throw new AiCredentialDecryptError();

      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(columns.payloadIv, "base64"),
        );
        decipher.setAuthTag(Buffer.from(columns.payloadAuthTag, "base64"));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(columns.payloadCiphertext, "base64")),
          decipher.final(),
        ]).toString("utf8");
        return parsePayload(JSON.parse(plaintext) as unknown);
      } catch (error) {
        if (error instanceof AiCredentialKeyUnavailableError) throw error;
        throw new AiCredentialDecryptError();
      }
    },
  };
}

export function createCredentialHint(
  credential: Credential | undefined,
): string | null {
  if (!credential || credential.type !== "api_key") return null;
  const key = credential.key?.trim();
  return key ? `****${key.slice(-4)}` : "configured";
}

function projectPayload(payload: AiEncryptedPayload): AiEncryptedPayload {
  return {
    credential: payload.credential,
    runtimeSettings: { ...payload.runtimeSettings },
  };
}

function parsePayload(value: unknown): AiEncryptedPayload {
  if (!isRecord(value) || !isStringRecord(value.runtimeSettings))
    throw new AiCredentialDecryptError();

  const credential = value.credential;
  if (credential !== undefined && !isCredential(credential))
    throw new AiCredentialDecryptError();

  return { credential, runtimeSettings: value.runtimeSettings };
}

function isCredential(value: unknown): value is Credential {
  if (!isRecord(value)) return false;

  if (value.type === "api_key") {
    return (
      (value.key === undefined || typeof value.key === "string") &&
      (value.env === undefined || isStringRecord(value.env))
    );
  }

  return (
    value.type === "oauth" &&
    typeof value.access === "string" &&
    typeof value.refresh === "string" &&
    typeof value.expires === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}
