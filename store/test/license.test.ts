import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  LicenseIssuer,
  loadOrCreateLicenseIssuer,
  verifyLicense,
} from '../src/license.js'
import type { Order } from '../src/types.js'

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    skuId: 'pro-1',
    tier: 'pro',
    packSize: 1,
    seats: 1,
    amount: 0.99,
    currency: 'USD',
    status: 'paid',
    createdAt: new Date().toISOString(),
    licenseKeys: [],
    deliveryStatus: 'pending',
    ...overrides,
  }
}

test('issues and verifies a signed pro license', () => {
  const keys = LicenseIssuer.generate()
  const issuer = new LicenseIssuer(keys.privateKeyPem, keys.publicKeyPem)
  const key = issuer.issue(order(), 0)
  const payload = verifyLicense(key, keys.publicKeyPem)

  assert.equal(payload.order, 'order-1')
  assert.equal(payload.tier, 'pro')
  assert.equal(payload.packIndex, 0)
  assert.ok(payload.expiresAt)
  assert.equal(issuer.verify(key).id, payload.id)
})

test('lifetime licenses never expire', () => {
  const keys = LicenseIssuer.generate()
  const issuer = new LicenseIssuer(keys.privateKeyPem, keys.publicKeyPem)
  const key = issuer.issue(order({ tier: 'lifetime' }), 0)
  const payload = verifyLicense(key, keys.publicKeyPem)
  assert.equal(payload.expiresAt, null)
})

test('rejects a tampered license', () => {
  const keys = LicenseIssuer.generate()
  const issuer = new LicenseIssuer(keys.privateKeyPem, keys.publicKeyPem)
  const key = issuer.issue(order(), 0)
  const parts = key.split('.')
  const tampered = `${parts[0]}.${parts[1]}.${'x'.repeat(parts[2]?.length ?? 86)}`
  assert.throws(() => verifyLicense(tampered, keys.publicKeyPem))
})

test('persists a generated keypair across restarts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-store-license-'))
  try {
    const first = await loadOrCreateLicenseIssuer(dir)
    const second = await loadOrCreateLicenseIssuer(dir)
    assert.equal(first.publicKeyPem, second.publicKeyPem)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
