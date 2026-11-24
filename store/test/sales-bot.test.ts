import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { BotOrderStore } from '../src/bot-orders.js'
import { SalesBot } from '../src/sales-bot.js'
import { MockTelegram } from '../src/telegram.js'

function update(
  chatId: number,
  userId: number,
  text: string,
  username = 'buyer',
) {
  return {
    update_id: 1,
    message: {
      text,
      chat: { id: chatId },
      from: { id: userId, username },
    },
  }
}

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-store-bot-'))
  const orders = new BotOrderStore(dir)
  await orders.init()
  const telegram = new MockTelegram()
  const bot = new SalesBot({
    telegram,
    orders,
    ownerChatId: 1,
  })
  return { dir, orders, telegram, bot }
}

test('creates an audit request and notifies the owner', async () => {
  const ctx = await setup()
  try {
    await ctx.bot.handleUpdate(update(2, 2, '/start'))
    assert.match(ctx.telegram.messages.at(-1)!.text, /DSH Auditor/)

    await ctx.bot.handleUpdate(update(2, 2, '/buy audit', 'alice'))
    const order = ctx.orders.all()[0]
    assert.ok(order)
    assert.equal(order.status, 'new')
    assert.equal(order.username, 'alice')
    assert.equal(order.price, 20)

    const texts = ctx.telegram.messages.map((message) => message.text)
    assert.ok(texts.some((text) => text.includes(order.id)))
    assert.ok(texts.some((text) => text.includes('Новая заявка на аудит')))

    await ctx.bot.handleUpdate(update(2, 2, `/status ${order.id}`))
    assert.match(ctx.telegram.messages.at(-1)!.text, /new/)
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('owner can issue and reject audit requests', async () => {
  const ctx = await setup()
  try {
    await ctx.bot.handleUpdate(update(2, 2, '/buy audit', 'alice'))
    const first = ctx.orders.all()[0]!

    await ctx.bot.handleUpdate(update(1, 1, '/orders'))
    assert.match(ctx.telegram.messages.at(-1)!.text, new RegExp(first.id))

    await ctx.bot.handleUpdate(update(2, 2, `/issue ${first.id}`))
    assert.match(ctx.telegram.messages.at(-1)!.text, /только для администратора/)

    await ctx.bot.handleUpdate(update(1, 1, `/issue ${first.id}`))
    assert.equal(ctx.orders.get(first.id)?.status, 'fulfilled')
    assert.match(ctx.telegram.messages.at(-1)!.text, /fulfilled/)

    await ctx.bot.handleUpdate(update(3, 3, '/buy audit', 'bob'))
    const second = ctx.orders.all().find((order) => order.id !== first.id)!
    await ctx.bot.handleUpdate(update(1, 1, `/reject ${second.id}`))
    assert.equal(ctx.orders.get(second.id)?.status, 'rejected')
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('unknown products and users cannot access admin commands', async () => {
  const ctx = await setup()
  try {
    await ctx.bot.handleUpdate(update(2, 2, '/buy pro10'))
    assert.match(ctx.telegram.messages.at(-1)!.text, /в разработке/)

    await ctx.bot.handleUpdate(update(2, 2, '/orders'))
    assert.match(ctx.telegram.messages.at(-1)!.text, /только для администратора/)

    await ctx.bot.handleUpdate(update(2, 2, '/id'))
    assert.match(ctx.telegram.messages.at(-1)!.text, /chat id: 2/)
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})
