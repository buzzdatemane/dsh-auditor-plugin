import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AddressInfo } from 'node:net'
import { CheckoutService } from '../src/checkout.js'
import type { StoreConfig } from '../src/config.js'
import { LicenseIssuer } from '../src/license.js'
import { OrderStore } from '../src/orders.js'
import { MockPaymentProvider } from '../src/payments/mock.js'
import { createServer } from '../src/server.js'
import { MockTelegram } from '../src/telegram.js'

async function start(proAvailable = true) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-store-http-'))
  const config: StoreConfig = {
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    paymentProvider: 'mock',
    proAvailable,
    dataDir: dir,
    publicDir: path.resolve('public'),
    telegram: {
      token: 'test-token',
      username: 'dsh_auditor_test_bot',
      webhookSecret: 'telegram-secret',
    },
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
  const server = createServer({
    config,
    orders,
    checkout,
    payments,
    licenses,
    telegram,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const base = `http://127.0.0.1:${address.port}`
  return { dir, base, server, orders, telegram }
}

async function json<T>(
  url: string,
  init?: RequestInit,
): Promise<{ response: Response; data: T }> {
  const response = await fetch(url, init)
  return { response, data: (await response.json()) as T }
}

test('serves pricing and completes the full mock checkout flow', async () => {
  const ctx = await start()
  try {
    const home = await fetch(`${ctx.base}/`)
    assert.equal(home.status, 200)
    assert.match(await home.text(), /DSH Auditor/)

    const skus = await json<{ skus: Array<{ id: string; amount: number }> }>(
      `${ctx.base}/api/skus`,
    )
    assert.equal(skus.response.status, 200)
    assert.equal(skus.data.skus.length, 4)

    const created = await json<{
      orderId: string
      checkoutUrl: string
      status: string
    }>(`${ctx.base}/api/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skuId: 'pro-10' }),
    })
    assert.equal(created.response.status, 201)
    assert.equal(created.data.status, 'pending')
    assert.match(created.data.checkoutUrl, /mock-checkout/)
    const invoiceId = new URL(created.data.checkoutUrl).searchParams.get(
      'invoice',
    )
    assert.ok(invoiceId)

    const pending = await json<{
      id: string
      status: string
      telegramUrl?: string
    }>(`${ctx.base}/api/orders/${created.data.orderId}`)
    assert.equal(pending.response.status, 200)
    assert.equal(pending.data.status, 'pending')
    assert.match(pending.data.telegramUrl ?? '', /t\.me\/dsh_auditor_test_bot/)

    const paid = await json<{ ok: boolean; orderId: string }>(
      `${ctx.base}/api/mock/pay`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      },
    )
    assert.equal(paid.response.status, 200)
    assert.equal(paid.data.orderId, created.data.orderId)

    const order = await json<{
      status: string
      licenseKeys: string[]
    }>(`${ctx.base}/api/orders/${created.data.orderId}`)
    assert.equal(order.response.status, 200)
    assert.equal(order.data.status, 'paid')
    assert.equal(order.data.licenseKeys.length, 10)

    const publicKey = await fetch(`${ctx.base}/api/license/public-key`)
    assert.equal(publicKey.status, 200)
    assert.match(await publicKey.text(), /BEGIN PUBLIC KEY/)

    const telegram = await json<{ ok: boolean }>(
      `${ctx.base}/telegram/webhook`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'telegram-secret',
        },
        body: JSON.stringify({
          message: {
            text: `/start ${created.data.orderId}`,
            chat: { id: 777 },
            from: { username: 'buyer' },
          },
        }),
      },
    )
    assert.equal(telegram.response.status, 200)
    assert.equal(ctx.telegram.messages.length, 1)
    assert.ok(ctx.telegram.messages[0]?.text.includes(order.data.licenseKeys[0]!))
  } finally {
    await new Promise<void>((resolve) => ctx.server.close(() => resolve()))
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('rejects bad Telegram secret, unknown SKU and missing order', async () => {
  const ctx = await start()
  try {
    const telegram = await fetch(`${ctx.base}/telegram/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'wrong',
      },
      body: JSON.stringify({ message: { text: '/start x', chat: { id: 1 } } }),
    })
    assert.equal(telegram.status, 401)

    const sku = await fetch(`${ctx.base}/api/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skuId: 'nope' }),
    })
    assert.equal(sku.status, 400)

    const missing = await fetch(`${ctx.base}/api/orders/nope`)
    assert.equal(missing.status, 404)
  } finally {
    await new Promise<void>((resolve) => ctx.server.close(() => resolve()))
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('keeps checkout closed while Pro is in development', async () => {
  const ctx = await start(false)
  try {
    const skus = await json<{ skus: Array<{ available: boolean; status: string }> }>(
      `${ctx.base}/api/skus`,
    )
    assert.equal(skus.data.skus[0]?.available, false)
    assert.equal(skus.data.skus[0]?.status, 'coming_soon')

    const checkout = await fetch(`${ctx.base}/api/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skuId: 'pro-10' }),
    })
    assert.equal(checkout.status, 503)
  } finally {
    await new Promise<void>((resolve) => ctx.server.close(() => resolve()))
    await rm(ctx.dir, { recursive: true, force: true })
  }
})
