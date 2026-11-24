/**
 * Long-polling Telegram sales bot for manual audit requests.
 *
 * No public HTTPS or webhook is required. The bot must be created in
 * @BotFather first; this process only reads updates and sends messages.
 */
import path from 'node:path'
import { BotOrderStore } from '../bot-orders.js'
import { SalesBot } from '../sales-bot.js'
import { TelegramBot } from '../telegram.js'

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {
    // optional
  }

  const token = optionalEnv('TELEGRAM_BOT_TOKEN')
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is missing.')
    console.error('Create a bot in @BotFather, put the token into store/.env, then run:')
    console.error('  npm run bot')
    process.exitCode = 1
    return
  }

  const ownerRaw = optionalEnv('TELEGRAM_OWNER_CHAT_ID')
  const ownerChatId = ownerRaw ? Number(ownerRaw) : undefined
  if (ownerRaw && !Number.isFinite(ownerChatId)) {
    throw new Error('TELEGRAM_OWNER_CHAT_ID must be a number')
  }

  const dataDir = path.resolve(optionalEnv('DATA_DIR') ?? 'data')
  const orders = new BotOrderStore(dataDir)
  await orders.init()
  const telegram = new TelegramBot(token)
  const me = await telegram.getMe()

  // getUpdates cannot run while a webhook is active.
  await telegram.deleteWebhook()

  const bot = new SalesBot({
    telegram,
    orders,
    ...(ownerChatId !== undefined ? { ownerChatId } : {}),
    log: (message) => console.log(`[sales-bot] ${message}`),
  })

  console.log(`Bot: @${me.username ?? 'unknown'}`)
  console.log(`Open: https://t.me/${me.username ?? ''}`)
  console.log(`Owner chat id: ${ownerChatId ?? '(not set; use /id in the bot)'}`)
  console.log('Long polling started. Press Ctrl+C to stop.')

  let offset = 0
  let running = true
  const stop = () => {
    running = false
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  while (running) {
    try {
      const updates = (await telegram.getUpdates(offset, 30)) as Array<{
        update_id?: number
      }>
      for (const update of updates) {
        if (typeof update.update_id === 'number') offset = update.update_id + 1
        try {
          await bot.handleUpdate(update)
        } catch (error) {
          console.error(
            'update handler failed:',
            error instanceof Error ? error.message : error,
          )
        }
      }
    } catch (error) {
      if (!running) break
      console.error(
        'getUpdates failed:',
        error instanceof Error ? error.message : error,
      )
      await sleep(3000)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
