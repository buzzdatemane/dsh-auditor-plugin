import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Order, Tier } from './types.js'

const PREFIX = 'dsa1'
const YEAR_MS = 365 * 24 * 60 * 60 * 1000

export interface LicensePayload {
  v: 1
  id: string
  order: string
  tier: Tier
  seats: number
  issuedAt: string
  expiresAt: string | null
  packIndex: number
}

function normalizePem(value: string): string {
  return value.includes('BEGIN') ? value : Buffer.from(value, 'base64').toString('utf8')
}

export class LicenseIssuer {
  private readonly privateKey: KeyObject
  readonly publicKeyPem: string

  constructor(privateKeyPem: string, publicKeyPem?: string) {
    this.privateKey = createPrivateKey(normalizePem(privateKeyPem))
    this.publicKeyPem = publicKeyPem
      ? normalizePem(publicKeyPem)
      : createPublicKey(this.privateKey)
          .export({ type: 'spki', format: 'pem' })
          .toString()
    // Eagerly validate the public key so a broken env fails at startup.
    createPublicKey(this.publicKeyPem)
  }

  static generate(): { privateKeyPem: string; publicKeyPem: string } {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    return {
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    }
  }

  issue(order: Order, packIndex: number): string {
    const payload: LicensePayload = {
      v: 1,
      id: randomUUID(),
      order: order.id,
      tier: order.tier,
      seats: order.seats,
      issuedAt: new Date().toISOString(),
      expiresAt:
        order.tier === 'lifetime'
          ? null
          : new Date(Date.now() + YEAR_MS).toISOString(),
      packIndex,
    }
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = sign(null, Buffer.from(body), this.privateKey).toString(
      'base64url',
    )
    return `${PREFIX}.${body}.${signature}`
  }

  verify(key: string): LicensePayload {
    return verifyLicense(key, this.publicKeyPem)
  }
}

export function verifyLicense(
  key: string,
  publicKeyPem: string,
): LicensePayload {
  const parts = key.trim().split('.')
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    throw new Error('Invalid license format')
  }
  const body = parts[1]
  const signature = parts[2]
  if (!body || !signature) throw new Error('Invalid license format')

  const ok = verify(
    null,
    Buffer.from(body),
    createPublicKey(normalizePem(publicKeyPem)),
    Buffer.from(signature, 'base64url'),
  )
  if (!ok) throw new Error('Invalid license signature')

  const parsed: unknown = JSON.parse(
    Buffer.from(body, 'base64url').toString('utf8'),
  )
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { v?: unknown }).v !== 1
  ) {
    throw new Error('Unsupported license version')
  }

  const payload = parsed as LicensePayload
  if (payload.expiresAt !== null) {
    const expires = Date.parse(payload.expiresAt)
    if (!Number.isFinite(expires) || expires <= Date.now()) {
      throw new Error('License expired')
    }
  }
  return payload
}

export async function loadOrCreateLicenseIssuer(
  dataDir: string,
  privateKeyPem?: string,
  publicKeyPem?: string,
): Promise<LicenseIssuer> {
  if (privateKeyPem) return new LicenseIssuer(privateKeyPem, publicKeyPem)

  await mkdir(dataDir, { recursive: true })
  const keyFile = path.join(dataDir, 'license-keypair.json')
  try {
    const stored: unknown = JSON.parse(await readFile(keyFile, 'utf8'))
    if (
      typeof stored === 'object' &&
      stored !== null &&
      typeof (stored as { privateKeyPem?: unknown }).privateKeyPem === 'string' &&
      typeof (stored as { publicKeyPem?: unknown }).publicKeyPem === 'string'
    ) {
      return new LicenseIssuer(
        (stored as { privateKeyPem: string }).privateKeyPem,
        (stored as { publicKeyPem: string }).publicKeyPem,
      )
    }
    throw new Error('Invalid license-keypair.json')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const keys = LicenseIssuer.generate()
  await writeFile(keyFile, `${JSON.stringify(keys, null, 2)}\n`, {
    mode: 0o600,
  })
  await chmod(keyFile, 0o600).catch(() => undefined)
  return new LicenseIssuer(keys.privateKeyPem, keys.publicKeyPem)
}
