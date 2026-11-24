import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CheckoutService } from '../src/checkout.js'
import type { StoreConfig } from '../src/config.js'
import { LicenseIssuer } from '../src/license.js'
import { OrderStore } from '../src/orders.js'
import { MockPaymentProvider } from '../src/payments/mock.js'
import { MockTelegram } from '../src/telegram.js'

async function setup(proAvailable = true) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-store-orders-'))
  const config: StoreConfig = {
    port: 0,
    baseUrl: 'http://localhost:8787',
    paymentProvider: 'mock',
    proAvailable,
    dataDir: dir,
    publicDir: path.resolve('public'),
  }
  const orders = new OrderStore(dir)
  await orders.init()
  const keys = LicenseIssuer.generate()
  const licenses = new LicenseIssuer(keys.privateKeyPem, keys.publicKeyPem)
  const payments = new MockPaymentProvider(config.baseUrl)
  const telegram = new MockTelegram()
  const checkout = new CheckoutService(
    config,
    orders,
    payments,
    licenses,
    telegram,
  )
  return { dir, config, orders, licenses, payments, telegram, checkout }
}

test('fulfills a pro-10 pack exactly once and delivers to Telegram', async () => {
  const ctx = await setup()
  try {
    const { order, checkoutUrl } = await ctx.checkout.createCheckout('pro-10')
    assert.equal(order.status, 'pending')
    assert.match(checkoutUrl, /mock-checkout/)
    assert.ok(order.invoiceId)

    await ctx.checkout.attachTelegram(order.id, 777, 'buyer')
    const paid = await ctx.checkout.processPaymentEvent({
      invoiceId: order.invoiceId!,
      type: 'paid',
    })
    assert.equal(paid?.status, 'paid')
    assert.equal(paid?.licenseKeys.length, 10)
    assert.equal(new Set(paid?.licenseKeys).size, 10)
    assert.equal(paid?.deliveryStatus, 'sent')
    assert.equal(ctx.telegram.messages.length, 1)
    assert.ok(ctx.telegram.messages[0]?.text.includes(paid!.licenseKeys[0]!))

    const again = await ctx.checkout.processPaymentEvent({
      invoiceId: order.invoiceId!,
      type: 'paid',
    })
    assert.equal(again?.licenseKeys.length, 10)
    assert.equal(ctx.telegram.messages.length, 1)

    for (const key of paid!.licenseKeys) {
      assert.equal(ctx.licenses.verify(key).order, order.id)
    }

    const reloaded = new OrderStore(ctx.dir)
    await reloaded.init()
    assert.equal(reloaded.get(order.id)?.status, 'paid')
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('team license carries five seats', async () => {
  const ctx = await setup()
  try {
    const { order } = await ctx.checkout.createCheckout('team-5')
    const paid = await ctx.checkout.processPaymentEvent({
      invoiceId: order.invoiceId!,
      type: 'paid',
    })
    assert.equal(paid?.tier, 'team')
    assert.equal(paid?.seats, 5)
    assert.equal(paid?.licenseKeys.length, 1)
    assert.equal(ctx.licenses.verify(paid!.licenseKeys[0]!).seats, 5)
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('expired invoice is marked expired without licenses', async () => {
  const ctx = await setup()
  try {
    const { order } = await ctx.checkout.createCheckout('pro-1')
    const expired = await ctx.checkout.processPaymentEvent({
      invoiceId: order.invoiceId!,
      type: 'expired',
    })
    assert.equal(expired?.status, 'expired')
    assert.deepEqual(expired?.licenseKeys, [])
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('unknown SKU is rejected', async () => {
  const ctx = await setup()
  try {
    await assert.rejects(
      ctx.checkout.createCheckout('does-not-exist'),
      /Unknown SKU/,
    )
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('pro checkout is disabled while the feature is in development', async () => {
  const ctx = await setup(false)
  try {
    await assert.rejects(
      ctx.checkout.createCheckout('pro-10'),
      /Pro is still in development/,
    )
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})
