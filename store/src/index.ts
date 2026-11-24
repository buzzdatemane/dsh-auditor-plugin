import { loadConfig } from './config.js'
import { CheckoutService } from './checkout.js'
import { loadOrCreateLicenseIssuer } from './license.js'
import { OrderStore } from './orders.js'
import { BtcpayProvider } from './payments/btcpay.js'
import { MockPaymentProvider } from './payments/mock.js'
import { createServer } from './server.js'
import { TelegramBot } from './telegram.js'

async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {
    // .env is optional; deployment environments may provide variables directly.
  }

  const config = loadConfig()
  const orders = new OrderStore(config.dataDir)
  await orders.init()
  const licenses = await loadOrCreateLicenseIssuer(
    config.dataDir,
    config.licensePrivateKeyPem,
    config.licensePublicKeyPem,
  )

  const payments =
    config.paymentProvider === 'btcpay'
      ? new BtcpayProvider(config.btcpay!)
      : new MockPaymentProvider(config.baseUrl)

  const telegram = config.telegram
    ? new TelegramBot(config.telegram.token)
    : undefined

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

  server.listen(config.port, () => {
    console.log(`dsh-auditor store: ${config.baseUrl}`)
    console.log(`payment provider: ${config.paymentProvider}`)
    console.log(`pro available: ${config.proAvailable}`)
    console.log(`data dir: ${config.dataDir}`)
    console.log(`license public key: ${config.baseUrl}/api/license/public-key`)
    if (config.paymentProvider === 'mock') {
      console.log('mock checkout is enabled (no real money)')
    }
  })

  if (config.telegram?.webhookSecret && config.baseUrl.startsWith('https://')) {
    try {
      await telegram?.setWebhook(
        `${config.baseUrl}/telegram/webhook`,
        config.telegram.webhookSecret,
      )
      console.log('telegram webhook configured')
    } catch (error) {
      console.error(
        'telegram setWebhook failed:',
        error instanceof Error ? error.message : error,
      )
    }
  }

  const shutdown = () => {
    server.close(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
