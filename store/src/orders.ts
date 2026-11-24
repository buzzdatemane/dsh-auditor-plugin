import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { Order } from './types.js'

interface CreateOrderInput {
  skuId: string
  tier: Order['tier']
  packSize: number
  seats: number
  amount: number
  currency: string
}

interface StoredFile {
  version: 1
  orders: Order[]
}

export class OrderStore {
  private readonly orders = new Map<string, Order>()
  private readonly file: string
  private writeChain: Promise<void> = Promise.resolve()
  private writeSequence = 0

  constructor(private readonly dataDir: string) {
    this.file = path.join(dataDir, 'orders.json')
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !Array.isArray((parsed as StoredFile).orders)
      ) {
        throw new Error('Invalid orders.json')
      }
      for (const order of (parsed as StoredFile).orders) {
        if (order && typeof order.id === 'string') {
          this.orders.set(order.id, order)
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  async create(input: CreateOrderInput): Promise<Order> {
    const order: Order = {
      id: randomUUID(),
      skuId: input.skuId,
      tier: input.tier,
      packSize: input.packSize,
      seats: input.seats,
      amount: input.amount,
      currency: input.currency,
      status: 'pending',
      createdAt: new Date().toISOString(),
      licenseKeys: [],
      deliveryStatus: 'pending',
    }
    this.orders.set(order.id, order)
    await this.persist()
    return order
  }

  get(id: string): Order | undefined {
    return this.orders.get(id)
  }

  findByInvoice(invoiceId: string): Order | undefined {
    for (const order of this.orders.values()) {
      if (order.invoiceId === invoiceId) return order
    }
    return undefined
  }

  all(): Order[] {
    return [...this.orders.values()].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    )
  }

  async update(order: Order): Promise<Order> {
    this.orders.set(order.id, order)
    await this.persist()
    return order
  }

  private async persist(): Promise<void> {
    const sequence = ++this.writeSequence
    const temp = path.join(
      this.dataDir,
      `orders.${process.pid}.${sequence}.tmp`,
    )
    const payload: StoredFile = {
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
