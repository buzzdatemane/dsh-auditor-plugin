/** Shared domain types for the dsh-auditor store. */

export type Tier = 'pro' | 'team' | 'lifetime'

export type OrderStatus = 'pending' | 'paid' | 'expired' | 'failed'

export type DeliveryStatus =
  | 'pending'
  | 'sent'
  | 'awaiting_telegram'
  | 'failed'

export interface Sku {
  id: string
  tier: Tier
  packSize: number
  seats: number
  amount: number
  currency: 'USD'
  label: string
  description: string
}

export interface PublicSku extends Sku {
  available: boolean
  status: 'available' | 'coming_soon'
}

export interface Order {
  id: string
  skuId: string
  tier: Tier
  packSize: number
  seats: number
  amount: number
  currency: string
  status: OrderStatus
  createdAt: string
  paidAt?: string
  invoiceId?: string
  checkoutUrl?: string
  telegramChatId?: number
  telegramUsername?: string
  licenseKeys: string[]
  deliveryStatus: DeliveryStatus
  deliveryError?: string
}

export interface CreateInvoiceInput {
  orderId: string
  amount: number
  currency: string
  description: string
  metadata: Record<string, string>
  redirectUrl: string
}

export interface Invoice {
  id: string
  checkoutUrl: string
}

export type PaymentEventType = 'paid' | 'expired' | 'failed'

export interface PaymentEvent {
  invoiceId: string
  type: PaymentEventType
  raw?: unknown
}

export interface PaymentProvider {
  readonly name: 'mock' | 'btcpay'
  createInvoice(input: CreateInvoiceInput): Promise<Invoice>
  verifyWebhook?(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): PaymentEvent | undefined
}

export interface TelegramSender {
  sendMessage(chatId: number, text: string): Promise<void>
}

export interface PublicOrder {
  id: string
  status: OrderStatus
  tier: Tier
  packSize: number
  seats: number
  amount: number
  currency: string
  createdAt: string
  paidAt?: string
  licenseKeys: string[]
  telegramUrl?: string
}
