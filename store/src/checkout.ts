import type { StoreConfig } from './config.js'
import { LicenseIssuer } from './license.js'
import { OrderStore } from './orders.js'
import { findSku } from './skus.js'
import { formatLicenseMessage } from './telegram.js'
import type {
  Order,
  PaymentEvent,
  PaymentProvider,
  TelegramSender,
} from './types.js'

export class CheckoutService {
  private readonly inFlight = new Map<string, Promise<Order>>()

  constructor(
    private readonly config: StoreConfig,
    private readonly orders: OrderStore,
    private readonly payments: PaymentProvider,
    private readonly licenses: LicenseIssuer,
    private readonly telegram?: TelegramSender,
  ) {}

  async createCheckout(
    skuId: string,
  ): Promise<{ order: Order; checkoutUrl: string }> {
    if (!this.config.proAvailable) {
      throw new Error('Pro is still in development')
    }
    const sku = findSku(skuId)
    if (!sku) throw new Error(`Unknown SKU: ${skuId}`)

    const order = await this.orders.create({
      skuId: sku.id,
      tier: sku.tier,
      packSize: sku.packSize,
      seats: sku.seats,
      amount: sku.amount,
      currency: sku.currency,
    })

    try {
      const invoice = await this.payments.createInvoice({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        description: `${sku.label} — ${sku.description}`,
        metadata: {
          skuId: sku.id,
          tier: sku.tier,
          packSize: String(sku.packSize),
        },
        redirectUrl: `${this.config.baseUrl}/success?order=${encodeURIComponent(order.id)}`,
      })
      order.invoiceId = invoice.id
      order.checkoutUrl = invoice.checkoutUrl
      await this.orders.update(order)
      return { order, checkoutUrl: invoice.checkoutUrl }
    } catch (error) {
      order.status = 'failed'
      order.deliveryStatus = 'failed'
      order.deliveryError =
        error instanceof Error ? error.message : String(error)
      await this.orders.update(order)
      throw error
    }
  }

  async processPaymentEvent(event: PaymentEvent): Promise<Order | undefined> {
    const order = this.orders.findByInvoice(event.invoiceId)
    if (!order) return undefined

    if (event.type === 'paid') return this.fulfill(order.id)

    if (order.status === 'pending') {
      order.status = event.type === 'expired' ? 'expired' : 'failed'
      order.deliveryStatus = 'failed'
      await this.orders.update(order)
    }
    return order
  }

  async fulfill(orderId: string): Promise<Order> {
    const order = this.orders.get(orderId)
    if (!order) throw new Error(`Unknown order: ${orderId}`)

    const existing = this.inFlight.get(orderId)
    if (existing) return existing
    const promise = this.doFulfill(order)
      .finally(() => this.inFlight.delete(orderId))
    this.inFlight.set(orderId, promise)
    return promise
  }

  async attachTelegram(
    orderId: string,
    chatId: number,
    username?: string,
  ): Promise<Order | undefined> {
    const order = this.orders.get(orderId)
    if (!order) return undefined
    order.telegramChatId = chatId
    if (username) order.telegramUsername = username
    await this.orders.update(order)
    if (order.status === 'paid') await this.deliver(order)
    return order
  }

  private async doFulfill(order: Order): Promise<Order> {
    const missing = order.packSize - order.licenseKeys.length
    if (missing > 0) {
      for (let index = order.licenseKeys.length; index < order.packSize; index += 1) {
        order.licenseKeys.push(this.licenses.issue(order, index))
      }
      order.status = 'paid'
      order.paidAt ??= new Date().toISOString()
      await this.orders.update(order)
    } else if (order.status !== 'paid') {
      order.status = 'paid'
      order.paidAt ??= new Date().toISOString()
      await this.orders.update(order)
    }

    if (order.deliveryStatus !== 'sent') await this.deliver(order)
    return order
  }

  private async deliver(order: Order): Promise<void> {
    if (!this.telegram || order.telegramChatId === undefined) {
      order.deliveryStatus = 'awaiting_telegram'
      await this.orders.update(order)
      return
    }

    try {
      await this.telegram.sendMessage(
        order.telegramChatId,
        formatLicenseMessage(order),
      )
      order.deliveryStatus = 'sent'
      order.deliveryError = undefined
    } catch (error) {
      order.deliveryStatus = 'failed'
      order.deliveryError =
        error instanceof Error ? error.message : String(error)
    }
    await this.orders.update(order)
  }
}
