/**
 * Check a BTCPay Server store and optionally register the invoice webhook.
 *
 * Usage:
 *   npm run btcpay:check
 *   npm run btcpay:check -- --create-webhook
 */
import { BtcpayProvider } from '../payments/btcpay.js'

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {
    // optional
  }

  const url = optionalEnv('BTCPAY_URL')
  const storeId = optionalEnv('BTCPAY_STORE_ID')
  const apiKey = optionalEnv('BTCPAY_API_KEY')
  const webhookSecret = optionalEnv('BTCPAY_WEBHOOK_SECRET')
  const baseUrl = (optionalEnv('BASE_URL') ?? '').replace(/\/+$/, '')
  const createWebhook = process.argv.includes('--create-webhook')

  if (!url || !storeId || !apiKey) {
    console.error('BTCPAY_URL, BTCPAY_STORE_ID and BTCPAY_API_KEY are required.')
    console.error('Fill them in store/.env; the API key needs permission to read the store and manage invoices/webhooks.')
    process.exitCode = 1
    return
  }

  const provider = new BtcpayProvider({
    url,
    storeId,
    apiKey,
    webhookSecret: webhookSecret ?? '',
  })

  const store = await provider.getStore()
  console.log(`BTCPay store: ${store.name ?? '(no name)'} (${store.id ?? storeId})`)

  const webhooks = await provider.listWebhooks()
  console.log(`Webhooks: ${webhooks.length}`)

  if (createWebhook) {
    if (!baseUrl.startsWith('https://')) {
      console.error('BASE_URL must be public HTTPS to register a BTCPay webhook.')
      process.exitCode = 1
      return
    }
    if (!webhookSecret) {
      console.error('BTCPAY_WEBHOOK_SECRET is required to create a webhook.')
      process.exitCode = 1
      return
    }
    const created = await provider.createWebhook(`${baseUrl}/api/btcpay/webhook`)
    console.log('Created webhook:')
    console.log(JSON.stringify(created, null, 2))
  }

  console.log('')
  console.log('Next:')
  console.log('1. Ensure the BTCPay webhook URL is /api/btcpay/webhook.')
  console.log('2. Enable InvoiceSettled, InvoiceExpired, InvoiceInvalid.')
  console.log('3. Use Lightning or USDT for micro-priced invoices.')
  console.log('4. Run a small real test payment before opening sales.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
