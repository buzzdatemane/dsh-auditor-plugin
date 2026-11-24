import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { LicenseIssuer } from '../src/license.js'
import {
  defaultPrice,
  defaultSeats,
  issueManualOrder,
  listManualOrders,
} from '../src/manual.js'

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-store-manual-'))
  const keys = LicenseIssuer.generate()
  const issuer = new LicenseIssuer(keys.privateKeyPem, keys.publicKeyPem)
  return { dir, issuer }
}

test('issues a manual pro-10 order and records it', async () => {
  const ctx = await setup()
  try {
    const order = await issueManualOrder({
      dataDir: ctx.dir,
      issuer: ctx.issuer,
      tier: 'pro',
      packSize: 10,
      seats: 1,
      price: 9.9,
      buyer: '@alice',
      orderId: 'manual-test-1',
    })

    assert.equal(order.id, 'manual-test-1')
    assert.equal(order.licenseKeys.length, 10)
    assert.equal(new Set(order.licenseKeys).size, 10)
    assert.equal(order.buyer, '@alice')

    for (const key of order.licenseKeys) {
      assert.equal(ctx.issuer.verify(key).order, 'manual-test-1')
    }

    const file = JSON.parse(
      await readFile(path.join(ctx.dir, 'manual-orders.json'), 'utf8'),
    )
    assert.equal(file.orders.length, 1)
    assert.equal(file.orders[0].licenseKeys.length, 10)
    assert.equal((await listManualOrders(ctx.dir)).length, 1)
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('rejects a duplicate manual order id', async () => {
  const ctx = await setup()
  try {
    await issueManualOrder({
      dataDir: ctx.dir,
      issuer: ctx.issuer,
      tier: 'lifetime',
      packSize: 1,
      seats: 1,
      price: 1.99,
      orderId: 'duplicate',
    })
    await assert.rejects(
      issueManualOrder({
        dataDir: ctx.dir,
        issuer: ctx.issuer,
        tier: 'pro',
        packSize: 1,
        seats: 1,
        price: 0.99,
        orderId: 'duplicate',
      }),
      /already exists/,
    )
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('uses the micro price table', () => {
  assert.equal(defaultPrice('pro', 1), 0.99)
  assert.equal(defaultPrice('pro', 10), 9.9)
  assert.equal(defaultPrice('team', 1), 2.99)
  assert.equal(defaultPrice('lifetime', 1), 1.99)
  assert.equal(defaultSeats('pro'), 1)
  assert.equal(defaultSeats('team'), 5)
})
