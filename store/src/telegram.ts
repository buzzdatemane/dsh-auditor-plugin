import type { Order, TelegramSender } from './types.js'

const MAX_MESSAGE = 3800

export class TelegramBot implements TelegramSender {
  private readonly apiBase: string

  constructor(
    private readonly token: string,
    apiBase = 'https://api.telegram.org',
  ) {
    this.apiBase = apiBase.replace(/\/+$/, '')
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    for (const chunk of chunkText(text, MAX_MESSAGE)) {
      const response = await fetch(
        `${this.apiBase}/bot${this.token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: chunk,
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      )
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(
          `Telegram sendMessage failed: HTTP ${response.status} ${body.slice(0, 300)}`,
        )
      }
    }
  }

  async getMe(): Promise<{ id: number; username?: string }> {
    const response = await fetch(`${this.apiBase}/bot${this.token}/getMe`, {
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await response.json()) as {
      ok?: boolean
      result?: { id?: number; username?: string }
      description?: string
    }
    if (!response.ok || !body.ok || typeof body.result?.id !== 'number') {
      throw new Error(
        `Telegram getMe failed: ${body.description ?? `HTTP ${response.status}`}`,
      )
    }
    const result: { id: number; username?: string } = {
      id: body.result.id,
    }
    if (body.result.username) result.username = body.result.username
    return result
  }

  async getWebhookInfo(): Promise<unknown> {
    const response = await fetch(
      `${this.apiBase}/bot${this.token}/getWebhookInfo`,
      { signal: AbortSignal.timeout(15_000) },
    )
    const body = (await response.json()) as {
      ok?: boolean
      result?: unknown
      description?: string
    }
    if (!response.ok || !body.ok) {
      throw new Error(
        `Telegram getWebhookInfo failed: ${body.description ?? `HTTP ${response.status}`}`,
      )
    }
    return body.result
  }

  async getUpdates(offset: number, timeout = 30): Promise<unknown[]> {
    const response = await fetch(
      `${this.apiBase}/bot${this.token}/getUpdates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offset,
          timeout,
          allowed_updates: ['message'],
        }),
        signal: AbortSignal.timeout((timeout + 10) * 1000),
      },
    )
    const body = (await response.json()) as {
      ok?: boolean
      result?: unknown
      description?: string
    }
    if (!response.ok || !body.ok) {
      throw new Error(
        `Telegram getUpdates failed: ${body.description ?? `HTTP ${response.status}`}`,
      )
    }
    return Array.isArray(body.result) ? body.result : []
  }

  async deleteWebhook(): Promise<void> {
    const response = await fetch(
      `${this.apiBase}/bot${this.token}/deleteWebhook`,
      { signal: AbortSignal.timeout(15_000) },
    )
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `Telegram deleteWebhook failed: HTTP ${response.status} ${body.slice(0, 300)}`,
      )
    }
  }

  async setWebhook(url: string, secret?: string): Promise<void> {
    const response = await fetch(
      `${this.apiBase}/bot${this.token}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          ...(secret ? { secret_token: secret } : {}),
          allowed_updates: ['message'],
        }),
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `Telegram setWebhook failed: HTTP ${response.status} ${body.slice(0, 300)}`,
      )
    }
  }
}

export class MockTelegram implements TelegramSender {
  readonly messages: Array<{ chatId: number; text: string }> = []

  async sendMessage(chatId: number, text: string): Promise<void> {
    this.messages.push({ chatId, text })
  }
}

export function formatLicenseMessage(order: Order): string {
  const lines = [
    'Оплата получена. Спасибо!',
    '',
    `Заказ: ${order.id}`,
    `Тариф: ${order.tier}${order.seats > 1 ? `, ${order.seats} мест` : ''}`,
    `Ключей: ${order.licenseKeys.length}`,
    '',
    ...order.licenseKeys.map((key, index) => `${index + 1}. ${key}`),
    '',
    'Ключ активируется в dsh-auditor-plugin. Сохраните это сообщение.',
  ]
  return lines.join('\n')
}

export function formatPendingMessage(order: Order): string {
  return [
    'Заказ найден, но оплата ещё не подтверждена.',
    `Заказ: ${order.id}`,
    'После подтверждения оплаты ключи придут сюда автоматически.',
  ].join('\n')
}

export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line
    if (candidate.length > limit && current) {
      chunks.push(current)
      current = line
    } else {
      current = candidate
    }
  }
  if (current) chunks.push(current)
  return chunks
}
