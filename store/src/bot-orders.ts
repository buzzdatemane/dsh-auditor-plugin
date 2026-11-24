import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type BotOrderStatus = 'new' | 'fulfilled' | 'rejected'

export interface BotOrder {
  id: string
  product: 'audit'
  price: number
  currency: 'USD'
  status: BotOrderStatus
  userId: number
  username?: string
  createdAt: string
  fulfilledAt?: string
  note?: string
}

interface BotOrdersFile {
  version: 1
  orders: BotOrder[]
}

export class BotOrderStore {
  private readonly orders = new Map<string, BotOrder>()
  private readonly file: string
  private writeChain: Promise<void> = Promise.resolve()
  private writeSequence = 0

  constructor(private readonly dataDir: string) {
    this.file = path.join(dataDir, 'bot-orders.json')
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !Array.isArray((parsed as BotOrdersFile).orders)
      ) {
        throw new Error('Invalid bot-orders.json')
      }
      for (const order of (parsed as BotOrdersFile).orders) {
        if (order && typeof order.id === 'string') {
          this.orders.set(order.id, order)
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  async create(input: {
    userId: number
    username?: string
    note?: string
  }): Promise<BotOrder> {
    const id = `A-${randomBytes(3).toString('hex').toUpperCase()}`
    const order: BotOrder = {
      id,
      product: 'audit',
      price: 20,
      currency: 'USD',
      status: 'new',
      userId: input.userId,
      createdAt: new Date().toISOString(),
    }
    if (input.username) order.username = input.username
    if (input.note) order.note = input.note
    this.orders.set(id, order)
    await this.persist()
    return order
  }

  get(id: string): BotOrder | undefined {
    return this.orders.get(id)
  }

  all(): BotOrder[] {
    return [...this.orders.values()].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    )
  }

  async update(order: BotOrder): Promise<BotOrder> {
    this.orders.set(order.id, order)
    await this.persist()
    return order
  }

  private async persist(): Promise<void> {
    const sequence = ++this.writeSequence
    const temp = path.join(
      this.dataDir,
      `bot-orders.${process.pid}.${sequence}.tmp`,
    )
    const payload: BotOrdersFile = {
      version: 1,
      orders: [...this.orders.values()],
    }
    this.writeChain = this.writeChain.then(async () => {
      await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, {
        mode: 0o600,
      })
      await rename(temp, this.file)
    })
    await this.writeChain
  }
}
