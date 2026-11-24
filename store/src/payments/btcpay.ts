import { createHmac, timingSafeEqual } from 'node:crypto'
import type { BtcpayConfig } from '../config.js'
import type {
  CreateInvoiceInput,
  Invoice,
  PaymentEvent,
  PaymentProvider,
} from '../types.js'

interface BtcpayInvoiceResponse {
  id?: unknown
  checkoutLink?: unknown
}

interface BtcpayWebhook {
  type?: unknown
  invoiceId?: unknown
  storeId?: unknown
}

export interface BtcpayStoreInfo {
  id?: string
  name?: string
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `token ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

function signatureHeader(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'btcpay-sig') continue
    return Array.isArray(value) ? value[0] : value
  }
  return undefined
}

export class BtcpayProvider implements PaymentProvider {
  readonly name = 'btcpay' as const
  private readonly baseUrl: string

  constructor(private readonly config: BtcpayConfig) {
    this.baseUrl = config.url.replace(/\/+$/, '')
  }

  async createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/stores/${encodeURIComponent(this.config.storeId)}/invoices`,
      {
        method: 'POST',
        headers: authHeaders(this.config.apiKey),
        body: JSON.stringify({
          amount: input.amount.toFixed(2),
          currency: input.currency,
          metadata: {
            orderId: input.orderId,
            ...input.metadata,
          },
          checkout: {
            redirectURL: input.redirectUrl,
            redirectAutomatically: true,
            defaultLanguage: 'en',
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    )

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `BTCPay invoice failed: HTTP ${response.status} ${body.slice(0, 300)}`,
      )
    }

    const parsed = (await response.json()) as BtcpayInvoiceResponse
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.checkoutLink !== 'string'
    ) {
      throw new Error('BTCPay invoice response is missing id or checkoutLink')
    }

    return { id: parsed.id, checkoutUrl: parsed.checkoutLink }
  }

  async getStore(): Promise<BtcpayStoreInfo> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/stores/${encodeURIComponent(this.config.storeId)}`,
      {
        headers: authHeaders(this.config.apiKey),
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `BTCPay getStore failed: HTTP ${response.status} ${body.slice(0, 300)}`,
      )
    }
    return (await response.json()) as BtcpayStoreInfo
  }

  async listWebhooks(): Promise<unknown[]> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/stores/${encodeURIComponent(this.config.storeId)}/webhooks`,
      {
        headers: authHeaders(this.config.apiKey),
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `BTCPay listWebhooks failed: HTTP ${response.status} ${body.slice(0, 300)}`,
      )
    }
    const parsed: unknown = await response.json()
    return Array.isArray(parsed) ? parsed : []
  }

  async createWebhook(url: string): Promise<unknown> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/stores/${encodeURIComponent(this.config.storeId)}/webhooks`,
      {
        method: 'POST',
        headers: authHeaders(this.config.apiKey),
        body: JSON.stringify({
          url,
          secret: this.config.webhookSecret,
          authorizedEvents: {
            allEvents: false,
            specificEvents: [
              'InvoiceSettled',
              'InvoiceExpired',
              'InvoiceInvalid',
            ],
          },
          enabled: true,
          automaticRedelivery: true,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `BTCPay createWebhook failed: HTTP ${response.status} ${body.slice(0, 300)}`,
      )
    }
    return response.json()
  }

  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): PaymentEvent | undefined {
    const header = signatureHeader(headers)
    if (!header) throw new Error('Missing BTCPay-Sig header')

    const provided = header.startsWith('sha256=')
      ? header.slice('sha256='.length)
      : header
    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(rawBody)
      .digest('hex')

    const providedBuffer = Buffer.from(provided, 'utf8')
    const expectedBuffer = Buffer.from(expected, 'utf8')
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new Error('Invalid BTCPay webhook signature')
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as BtcpayWebhook
    if (typeof payload.invoiceId !== 'string') {
      throw new Error('BTCPay webhook is missing invoiceId')
    }
    if (
      typeof payload.storeId === 'string' &&
      payload.storeId !== this.config.storeId
    ) {
      throw new Error('BTCPay webhook storeId mismatch')
    }

    switch (payload.type) {
      case 'InvoiceSettled':
        return { invoiceId: payload.invoiceId, type: 'paid', raw: payload }
      case 'InvoiceExpired':
        return { invoiceId: payload.invoiceId, type: 'expired', raw: payload }
      case 'InvoiceInvalid':
        return { invoiceId: payload.invoiceId, type: 'failed', raw: payload }
      default:
        return undefined
    }
  }
}
