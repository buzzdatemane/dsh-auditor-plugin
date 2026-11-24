import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { BtcpayProvider } from '../src/payments/btcpay.js'

const config = {
  url: 'https://btcpay.example',
  storeId: 'store-1',
  apiKey: 'api-key',
  webhookSecret: 'webhook-secret',
}

function signedBody(payload: unknown): {
  body: Buffer
  headers: Record<string, string>
} {
  const body = Buffer.from(JSON.stringify(payload))
  const sig = createHmac('sha256', config.webhookSecret)
    .update(body)
    .digest('hex')
  return { body, headers: { 'btcpay-sig': `sha256=${sig}` } }
}

test('parses a signed InvoiceSettled webhook', () => {
  const provider = new BtcpayProvider(config)
  const { body, headers } = signedBody({
    type: 'InvoiceSettled',
    invoiceId: 'inv-1',
    storeId: config.storeId,
  })
  assert.deepEqual(provider.verifyWebhook(headers, body), {
    invoiceId: 'inv-1',
    type: 'paid',
    raw: {
      type: 'InvoiceSettled',
      invoiceId: 'inv-1',
      storeId: config.storeId,
    },
  })
})

test('maps expired and invalid events', () => {
  const provider = new BtcpayProvider(config)
  const expired = signedBody({
    type: 'InvoiceExpired',
    invoiceId: 'inv-2',
    storeId: config.storeId,
  })
  assert.equal(provider.verifyWebhook(expired.headers, expired.body)?.type, 'expired')

  const invalid = signedBody({
    type: 'InvoiceInvalid',
    invoiceId: 'inv-3',
    storeId: config.storeId,
  })
  assert.equal(provider.verifyWebhook(invalid.headers, invalid.body)?.type, 'failed')
})

test('rejects bad signatures and foreign stores', () => {
  const provider = new BtcpayProvider(config)
  assert.throws(
    () =>
      provider.verifyWebhook(
        { 'btcpay-sig': 'sha256=deadbeef' },
        Buffer.from('{}'),
      ),
    /Invalid BTCPay webhook signature/,
  )

  const foreign = signedBody({
    type: 'InvoiceSettled',
    invoiceId: 'inv-4',
    storeId: 'other-store',
  })
  assert.throws(
    () => provider.verifyWebhook(foreign.headers, foreign.body),
    /storeId mismatch/,
  )
})

test('ignores unknown event types', () => {
  const provider = new BtcpayProvider(config)
  const unknown = signedBody({
    type: 'InvoiceProcessing',
    invoiceId: 'inv-5',
    storeId: config.storeId,
  })
  assert.equal(provider.verifyWebhook(unknown.headers, unknown.body), undefined)
})
