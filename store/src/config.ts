import path from 'node:path'

export interface BtcpayConfig {
  url: string
  storeId: string
  apiKey: string
  webhookSecret: string
}

export interface TelegramConfig {
  token: string
  username?: string
  webhookSecret?: string
}

export interface StoreConfig {
  port: number
  baseUrl: string
  paymentProvider: 'mock' | 'btcpay'
  proAvailable: boolean
  dataDir: string
  publicDir: string
  adminToken?: string
  btcpay?: BtcpayConfig
  telegram?: TelegramConfig
  licensePrivateKeyPem?: string
  licensePublicKeyPem?: string
}

function required(
  env: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StoreConfig {
  const port = Number(env.PORT ?? 8787)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`)
  }

  const baseUrl = (env.BASE_URL?.trim() || `http://localhost:${port}`).replace(/\/+$/, '')
  const provider = (env.PAYMENT_PROVIDER?.trim() || 'mock').toLowerCase()
  if (provider !== 'mock' && provider !== 'btcpay') {
    throw new Error('PAYMENT_PROVIDER must be "mock" or "btcpay"')
  }

  const config: StoreConfig = {
    port,
    baseUrl,
    paymentProvider: provider,
    proAvailable: /^(?:1|true|yes|on)$/i.test(
      env.PRO_AVAILABLE?.trim() || 'false',
    ),
    dataDir: path.resolve(env.DATA_DIR?.trim() || 'data'),
    publicDir: path.resolve(env.PUBLIC_DIR?.trim() || 'public'),
  }

  if (env.ADMIN_TOKEN?.trim()) config.adminToken = env.ADMIN_TOKEN.trim()

  if (provider === 'btcpay') {
    config.btcpay = {
      url: required(env, 'BTCPAY_URL').replace(/\/+$/, ''),
      storeId: required(env, 'BTCPAY_STORE_ID'),
      apiKey: required(env, 'BTCPAY_API_KEY'),
      webhookSecret: required(env, 'BTCPAY_WEBHOOK_SECRET'),
    }
  }

  const telegramToken = env.TELEGRAM_BOT_TOKEN?.trim()
  if (telegramToken) {
    config.telegram = {
      token: telegramToken,
      username: env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '') || undefined,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined,
    }
  }

  if (env.LICENSE_PRIVATE_KEY?.trim()) {
    config.licensePrivateKeyPem = env.LICENSE_PRIVATE_KEY.replace(/\\n/g, '\n')
  }
  if (env.LICENSE_PUBLIC_KEY?.trim()) {
    config.licensePublicKeyPem = env.LICENSE_PUBLIC_KEY.replace(/\\n/g, '\n')
  }

  return config
}
