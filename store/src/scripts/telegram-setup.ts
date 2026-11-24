/**
 * Validate TELEGRAM_BOT_TOKEN and (re)register the DSH store webhook.
 *
 * The bot itself must be created manually in @BotFather. This command only
 * checks the token, calls setWebhook/getWebhookInfo, and prints diagnostics.
 */
import { TelegramBot } from '../telegram.js'

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

function usage(): void {
  console.log('Usage: npm run telegram:setup [-- --delete]')
  console.log('  --delete   remove the current Telegram webhook')
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {
    // optional
  }

  const args = new Set(process.argv.slice(2))
  if (args.has('--help') || args.has('-h')) {
    usage()
    return
  }

  const token = optionalEnv('TELEGRAM_BOT_TOKEN')
  const baseUrl = (optionalEnv('BASE_URL') ?? '').replace(/\/+$/, '')
  const secret = optionalEnv('TELEGRAM_WEBHOOK_SECRET')

  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is missing.')
    console.error('')
    console.error('1. Open Telegram and start @BotFather.')
    console.error('2. Send /newbot, choose a name and a username ending with "bot".')
    console.error('3. Copy the HTTP API token into store/.env as TELEGRAM_BOT_TOKEN.')
    console.error('4. Set TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET.')
    console.error('5. Re-run: npm run telegram:setup')
    process.exitCode = 1
    return
  }

  const bot = new TelegramBot(token)
  const me = await bot.getMe()
  console.log(`Bot: @${me.username ?? 'unknown'} (id ${me.id})`)

  if (args.has('--delete')) {
    await bot.deleteWebhook()
    console.log('Telegram webhook deleted.')
    return
  }

  if (!baseUrl.startsWith('https://')) {
    console.error('BASE_URL must be a public HTTPS URL for Telegram webhook.')
    console.error('Local test: cloudflared tunnel --url http://localhost:8787')
    console.error('Then set BASE_URL to the printed https://*.trycloudflare.com URL.')
    process.exitCode = 1
    return
  }
  if (!secret) {
    console.error('TELEGRAM_WEBHOOK_SECRET is missing; refusing to set an unauthenticated webhook.')
    process.exitCode = 1
    return
  }

  await bot.setWebhook(`${baseUrl}/telegram/webhook`, secret)
  console.log(`Webhook: ${baseUrl}/telegram/webhook`)
  console.log('Webhook info:')
  console.log(JSON.stringify(await bot.getWebhookInfo(), null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
