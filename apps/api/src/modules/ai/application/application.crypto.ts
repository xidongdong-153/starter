import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const SECRET_PREFIX_LENGTH = 12
const SECRET_BYTES = 32

export function createAppSecret(): {
  secret: string
  hash: string
  prefix: string
} {
  const secret = `ai_${randomBytes(SECRET_BYTES).toString('base64url')}`
  return {
    secret,
    hash: hashAppSecret(secret),
    prefix: secret.slice(0, SECRET_PREFIX_LENGTH),
  }
}

export function hashAppSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export function verifyAppSecret(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashAppSecret(secret), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
