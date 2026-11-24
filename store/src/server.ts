import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { StoreConfig } from './config.js'
import type { CheckoutService } from './checkout.js'
import type { LicenseIssuer } from './license.js'
import type { OrderStore } from './orders.js'
import { SKUS, findSku } from './skus.js'
import { formatPendingMessage } from './telegram.js'
import type {
  Order,
  PaymentProvider,
  PublicOrder,
  TelegramSender,
} from './types.js'

export interface AppDeps {
  config: StoreConfig
  orders: OrderStore
  checkout: CheckoutService
  payments: PaymentProvider
  licenses: LicenseIssuer
  telegram?: TelegramSender
}

const MAX_BODY = 1_000_000

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

function sendText(
  response: ServerResponse,
  status: number,
  text: string,
  contentType = 'text/plain; charset=utf-8',
): void {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  response.end(text)
}

async function readBody(
  request: IncomingMessage,
  limit = MAX_BODY,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new HttpError(413, 'Request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const body = await readBody(request)
  try {
    return JSON.parse(body.toString('utf8')) as T
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

function publicOrder(
  order: Order,
  config: StoreConfig,
): PublicOrder {
  const result: PublicOrder = {
    id: order.id,
    status: order.status,
    tier: order.tier,
    packSize: order.packSize,
    seats: order.seats,
    amount: order.amount,
    currency: order.currency,
    createdAt: order.createdAt,
    licenseKeys: order.status === 'paid' ? order.licenseKeys : [],
  }
  if (order.paidAt) result.paidAt = order.paidAt
  if (config.telegram?.username) {
    result.telegramUrl = `https://t.me/${config.telegram.username}?start=${encodeURIComponent(order.id)}`
  }
  return result
}

function bearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization
  if (typeof header !== 'string') return undefined
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

async function serveStatic(
  requestPath: string,
  publicDir: string,
  response: ServerResponse,
): Promise<boolean> {
  const mapping: Record<string, string> = {
    '/': 'index.html',
    '/success': 'success.html',
    '/mock-checkout': 'mock-checkout.html',
    '/styles.css': 'styles.css',
  }
  const file = mapping[requestPath]
  if (!file) return false

  const full = path.resolve(publicDir, file)
  if (full !== publicDir && !full.startsWith(`${publicDir}${path.sep}`)) {
    throw new HttpError(403, 'Forbidden')
  }
  try {
    const info = await stat(full)
    if (!info.isFile()) return false
    const body = await readFile(full)
    const type =
      file.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : 'text/html; charset=utf-8'
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    })
    response.end(body)
    return true
  } catch {
    return false
  }
}

function telegramUpdate(body: unknown): {
  chatId?: number
  username?: string
  text?: string
} {
  if (typeof body !== 'object' || body === null) return {}
  const message = (body as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return {}
  const chat = (message as { chat?: unknown }).chat
  const from = (message as { from?: unknown }).from
  const text = (message as { text?: unknown }).text
  return {
    chatId:
      typeof chat === 'object' && chat !== null
        ? (chat as { id?: number }).id
        : undefined,
    username:
      typeof from === 'object' && from !== null
        ? (from as { username?: string }).username
        : undefined,
    text: typeof text === 'string' ? text : undefined,
  }
}

export function createServer(deps: AppDeps) {
  const { config, orders, checkout, payments, licenses, telegram } = deps

  return createHttpServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', config.baseUrl)
      const method = request.method ?? 'GET'

      if (method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true, provider: config.paymentProvider })
        return
      }

      if (method === 'GET' && url.pathname === '/api/skus') {
        sendJson(response, 200, {
          skus: SKUS.map((sku) => ({
            ...sku,
            available: config.proAvailable,
            status: config.proAvailable ? 'available' : 'coming_soon',
          })),
        })
        return
      }

      if (method === 'GET' && url.pathname === '/api/public-config') {
        sendJson(response, 200, {
          paymentProvider: config.paymentProvider,
          proAvailable: config.proAvailable,
          telegramBotUsername: config.telegram?.username ?? null,
        })
        return
      }

      if (method === 'GET' && url.pathname === '/api/license/public-key') {
        sendText(response, 200, licenses.publicKeyPem)
        return
      }

      if (method === 'POST' && url.pathname === '/api/checkout') {
        if (!config.proAvailable) {
          throw new HttpError(503, 'Pro is still in development')
        }
        const body = await readJson<{ skuId?: unknown }>(request)
        if (typeof body.skuId !== 'string') {
          throw new HttpError(400, 'skuId must be a string')
        }
        if (!findSku(body.skuId)) {
          throw new HttpError(400, 'Unknown SKU')
        }
        const created = await checkout.createCheckout(body.skuId)
        sendJson(response, 201, {
          orderId: created.order.id,
          checkoutUrl: created.checkoutUrl,
          status: created.order.status,
        })
        return
      }

      if (method === 'GET' && url.pathname.startsWith('/api/orders/')) {
        const id = decodeURIComponent(
          url.pathname.slice('/api/orders/'.length),
        )
        const order = orders.get(id)
        if (!order) throw new HttpError(404, 'Order not found')
        sendJson(response, 200, publicOrder(order, config))
        return
      }

      if (method === 'POST' && url.pathname === '/api/mock/pay') {
        if (config.paymentProvider !== 'mock') {
          throw new HttpError(404, 'Mock payments are disabled')
        }
        const body = await readJson<{ invoiceId?: unknown }>(request)
        if (typeof body.invoiceId !== 'string') {
          throw new HttpError(400, 'invoiceId must be a string')
        }
        const order = await checkout.processPaymentEvent({
          invoiceId: body.invoiceId,
          type: 'paid',
        })
        if (!order) throw new HttpError(404, 'Invoice not found')
        sendJson(response, 200, {
          ok: true,
          orderId: order.id,
          status: order.status,
        })
        return
      }

      if (method === 'POST' && url.pathname === '/api/btcpay/webhook') {
        if (!payments.verifyWebhook || config.paymentProvider !== 'btcpay') {
          throw new HttpError(404, 'BTCPay webhook is disabled')
        }
        const raw = await readBody(request)
        let event
        try {
          event = payments.verifyWebhook(
            request.headers as Record<string, string | string[] | undefined>,
            raw,
          )
        } catch (error) {
          throw new HttpError(
            401,
            error instanceof Error ? error.message : 'Invalid webhook',
          )
        }
        if (!event) {
          sendJson(response, 200, { ok: true, ignored: true })
          return
        }
        const order = await checkout.processPaymentEvent(event)
        sendJson(response, 200, { ok: true, orderId: order?.id ?? null })
        return
      }

      if (method === 'POST' && url.pathname === '/telegram/webhook') {
        const expected = config.telegram?.webhookSecret
        if (expected) {
          const provided = request.headers['x-telegram-bot-api-secret-token']
          if (
            typeof provided !== 'string' ||
            !secureEqual(provided, expected)
          ) {
            throw new HttpError(401, 'Invalid Telegram webhook secret')
          }
        }
        const body = await readJson<unknown>(request)
        const update = telegramUpdate(body)
        if (
          update.chatId === undefined ||
          !update.text ||
          !update.text.startsWith('/start')
        ) {
          sendJson(response, 200, { ok: true, ignored: true })
          return
        }

        const orderId = update.text.split(/\s+/)[1]
        if (!orderId) {
          sendJson(response, 200, { ok: true, ignored: true })
          return
        }

        const order = await checkout.attachTelegram(
          orderId,
          update.chatId,
          update.username,
        )
        if (!order) {
          await telegram?.sendMessage(
            update.chatId,
            'Заказ не найден. Проверьте ссылку из письма/страницы оплаты.',
          )
          sendJson(response, 200, { ok: true, orderId: null })
          return
        }

        if (order.status !== 'paid') {
          await telegram?.sendMessage(
            update.chatId,
            formatPendingMessage(order),
          )
        }
        sendJson(response, 200, { ok: true, orderId: order.id })
        return
      }

      if (method === 'GET' && url.pathname === '/api/admin/orders') {
        if (!config.adminToken) throw new HttpError(404, 'Not found')
        const token = bearerToken(request)
        if (!token || !secureEqual(token, config.adminToken)) {
          throw new HttpError(401, 'Unauthorized')
        }
        sendJson(response, 200, { orders: orders.all() })
        return
      }

      if (
        method === 'GET' &&
        url.pathname === '/mock-checkout' &&
        config.paymentProvider !== 'mock'
      ) {
        throw new HttpError(404, 'Not found')
      }

      if (method === 'GET' && (await serveStatic(url.pathname, config.publicDir, response))) {
        return
      }

      throw new HttpError(404, 'Not found')
    } catch (error) {
      if (response.headersSent) return
      const status = error instanceof HttpError ? error.status : 500
      const message =
        error instanceof Error ? error.message : 'Internal server error'
      sendJson(response, status, { error: message })
    }
  })
}
