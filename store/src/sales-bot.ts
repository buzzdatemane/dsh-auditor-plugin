import type { BotOrderStore } from './bot-orders.js'
import type { TelegramSender } from './types.js'

interface TelegramUpdate {
  update_id?: number
  message?: {
    text?: string
    chat?: { id?: number; username?: string }
    from?: { id?: number; username?: string }
  }
}

export interface SalesBotOptions {
  telegram: TelegramSender
  orders: BotOrderStore
  ownerChatId?: number
  log?: (message: string) => void
}

const WELCOME = [
  'DSH Auditor — security-аудит DSH-плагинов.',
  '',
  'Доступно сейчас:',
  '/buy audit — ручной аудит одного плагина, $20',
  '/status <id> — статус заявки',
  '/id — узнать свой Telegram chat id',
  '/help — помощь',
  '',
  'Оплата: USDT / BTC / Lightning. Реквизиты пришлёт администратор.',
].join('\n')

const HELP = [
  'Команды:',
  '/buy audit — создать заявку на аудит ($20)',
  '/status <id> — статус заявки',
  '/id — chat id',
  '',
  'Pro/Team/Lifetime пока в разработке.',
].join('\n')

function chatIdOf(update: TelegramUpdate): number | undefined {
  return update.message?.chat?.id
}

function userIdOf(update: TelegramUpdate): number | undefined {
  return update.message?.from?.id ?? update.message?.chat?.id
}

function usernameOf(update: TelegramUpdate): string | undefined {
  return update.message?.from?.username ?? update.message?.chat?.username
}

export class SalesBot {
  private readonly ownerChatId?: number
  private readonly log: (message: string) => void

  constructor(private readonly options: SalesBotOptions) {
    this.ownerChatId = options.ownerChatId
    this.log = options.log ?? (() => undefined)
  }

  async handleUpdate(raw: unknown): Promise<void> {
    const update = raw as TelegramUpdate
    const chatId = chatIdOf(update)
    const userId = userIdOf(update)
    const text = update.message?.text?.trim()
    if (chatId === undefined || userId === undefined || !text) return

    const [command = '', ...args] = text.split(/\s+/)
    switch (command.toLowerCase()) {
      case '/start':
        await this.reply(chatId, WELCOME)
        return
      case '/help':
        await this.reply(chatId, HELP)
        return
      case '/id':
        await this.reply(
          chatId,
          `Ваш chat id: ${chatId}\nВаш user id: ${userId}`,
        )
        return
      case '/buy':
        await this.buy(chatId, userId, usernameOf(update), args)
        return
      case '/status':
        await this.status(chatId, userId, args[0])
        return
      case '/orders':
        await this.listOrders(chatId, userId)
        return
      case '/issue':
        await this.issue(chatId, userId, args[0])
        return
      case '/reject':
        await this.reject(chatId, userId, args[0])
        return
      default:
        await this.reply(chatId, HELP)
    }
  }

  private async buy(
    chatId: number,
    userId: number,
    username: string | undefined,
    args: string[],
  ): Promise<void> {
    const product = args[0]?.toLowerCase()
    if (!product) {
      await this.reply(
        chatId,
        'Выбери продукт:\n/buy audit — аудит плагина, $20\n\nPro/Team/Lifetime пока в разработке.',
      )
      return
    }
    if (product !== 'audit') {
      await this.reply(
        chatId,
        'Pro/Team/Lifetime пока в разработке. Сейчас доступен /buy audit — ручной аудит за $20.',
      )
      return
    }

    const order = await this.options.orders.create({
      userId,
      ...(username ? { username } : {}),
    })
    await this.reply(
      chatId,
      [
        `Заявка ${order.id} создана.`,
        'Аудит одного DSH-плагина — $20.',
        'Администратор свяжется с тобой и пришлёт реквизиты.',
        `Статус: /status ${order.id}`,
      ].join('\n'),
    )

    if (this.ownerChatId !== undefined) {
      await this.options.telegram.sendMessage(
        this.ownerChatId,
        [
          'Новая заявка на аудит',
          `ID: ${order.id}`,
          `Покупатель: ${username ? `@${username}` : 'без username'} (id ${userId})`,
          `Цена: $${order.price.toFixed(2)}`,
          `Создана: ${order.createdAt}`,
          '',
          `Выдать: /issue ${order.id}`,
          `Отклонить: /reject ${order.id}`,
        ].join('\n'),
      )
    } else {
      this.log(`owner chat id is not configured; order ${order.id} stored`)
    }
  }

  private async status(
    chatId: number,
    userId: number,
    rawId: string | undefined,
  ): Promise<void> {
    if (!rawId) {
      await this.reply(chatId, 'Использование: /status A-XXXXXX')
      return
    }
    const order = this.options.orders.get(rawId.toUpperCase())
    if (!order || (order.userId !== userId && !this.isOwner(userId))) {
      await this.reply(chatId, 'Заявка не найдена.')
      return
    }
    await this.reply(
      chatId,
      `Заявка ${order.id}\nСтатус: ${order.status}\nЦена: $${order.price.toFixed(2)}\nСоздана: ${order.createdAt}`,
    )
  }

  private async listOrders(chatId: number, userId: number): Promise<void> {
    if (!this.isOwner(userId)) {
      await this.reply(chatId, 'Команда только для администратора.')
      return
    }
    const orders = this.options.orders.all().slice(0, 20)
    if (orders.length === 0) {
      await this.reply(chatId, 'Заявок нет.')
      return
    }
    await this.reply(
      chatId,
      orders
        .map(
          (order) =>
            `${order.id}  ${order.status}  ${order.username ? `@${order.username}` : order.userId}  $${order.price.toFixed(2)}`,
        )
        .join('\n'),
    )
  }

  private async issue(
    chatId: number,
    userId: number,
    rawId: string | undefined,
  ): Promise<void> {
    if (!this.isOwner(userId)) {
      await this.reply(chatId, 'Команда только для администратора.')
      return
    }
    if (!rawId) {
      await this.reply(chatId, 'Использование: /issue A-XXXXXX')
      return
    }
    const order = this.options.orders.get(rawId.toUpperCase())
    if (!order) {
      await this.reply(chatId, 'Заявка не найдена.')
      return
    }
    if (order.status !== 'new') {
      await this.reply(chatId, `Заявка уже ${order.status}.`)
      return
    }

    order.status = 'fulfilled'
    order.fulfilledAt = new Date().toISOString()
    await this.options.orders.update(order)
    await this.options.telegram.sendMessage(
      order.userId,
      `Заявка ${order.id} принята. Аудит согласован; администратор пришлёт отчёт после проверки.`,
    )
    await this.reply(
      chatId,
      `Заявка ${order.id} отмечена fulfilled. Покупатель уведомлён.`,
    )
  }

  private async reject(
    chatId: number,
    userId: number,
    rawId: string | undefined,
  ): Promise<void> {
    if (!this.isOwner(userId)) {
      await this.reply(chatId, 'Команда только для администратора.')
      return
    }
    if (!rawId) {
      await this.reply(chatId, 'Использование: /reject A-XXXXXX')
      return
    }
    const order = this.options.orders.get(rawId.toUpperCase())
    if (!order) {
      await this.reply(chatId, 'Заявка не найдена.')
      return
    }
    if (order.status !== 'new') {
      await this.reply(chatId, `Заявка уже ${order.status}.`)
      return
    }
    order.status = 'rejected'
    await this.options.orders.update(order)
    await this.options.telegram.sendMessage(
      order.userId,
      `Заявка ${order.id} отклонена. Если это ошибка, напиши администратору.`,
    )
    await this.reply(chatId, `Заявка ${order.id} отклонена.`)
  }

  private isOwner(userId: number): boolean {
    return this.ownerChatId !== undefined && userId === this.ownerChatId
  }

  private async reply(chatId: number, text: string): Promise<void> {
    await this.options.telegram.sendMessage(chatId, text)
  }
}
