import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { LicenseIssuer } from './license.js'
import type { Order, Tier } from './types.js'

export interface ManualOrder {
  id: string
  buyer?: string
  tier: Tier
  packSize: number
  seats: number
  price: number
  currency: 'USD'
  createdAt: string
  licenseKeys: string[]
  note?: string
}

interface ManualOrdersFile {
  version: 1
  orders: ManualOrder[]
}

export interface IssueManualInput {
  dataDir: string
  issuer: LicenseIssuer
  tier: Tier
  packSize: number
  seats: number
  price: number
  orderId?: string
  buyer?: string
  note?: string
}

export function defaultSeats(tier: Tier): number {
  return tier === 'team' ? 5 : 1
}

export function defaultPrice(tier: Tier, packSize: number): number {
  if (tier === 'team') return 2.99 * packSize
  if (tier === 'lifetime') return 1.99 * packSize
  return packSize >= 10 ? 9.9 : 0.99 * packSize
}

function ordersFile(dataDir: string): string {
  return path.join(dataDir, 'manual-orders.json')
}

async function readOrders(dataDir: string): Promise<ManualOrder[]> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(ordersFile(dataDir), 'utf8'),
    )
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as ManualOrdersFile).orders)
    ) {
      return (parsed as ManualOrdersFile).orders
    }
    throw new Error('Invalid manual-orders.json')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function writeOrders(
  dataDir: string,
  orders: readonly ManualOrder[],
): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  const file = ordersFile(dataDir)
  const temp = `${file}.${process.pid}.tmp`
  const payload: ManualOrdersFile = { version: 1, orders: [...orders] }
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  })
  await rename(temp, file)
}

export async function issueManualOrder(
  input: IssueManualInput,
): Promise<ManualOrder> {
  if (!Number.isInteger(input.packSize) || input.packSize < 1 || input.packSize > 100) {
    throw new Error('packSize must be an integer between 1 and 100')
  }
  if (!Number.isInteger(input.seats) || input.seats < 1) {
    throw new Error('seats must be a positive integer')
  }

  const orderId =
    input.orderId?.trim() ||
    `manual-${Date.now()}-${randomBytes(3).toString('hex')}`
  const existing = await readOrders(input.dataDir)
  if (existing.some((order) => order.id === orderId)) {
    throw new Error(`Manual order already exists: ${orderId}`)
  }

  const createdAt = new Date().toISOString()
  const order: Order = {
    id: orderId,
    skuId: 'manual',
    tier: input.tier,
    packSize: input.packSize,
    seats: input.seats,
    amount: input.price,
    currency: 'USD',
    status: 'paid',
    createdAt,
    paidAt: createdAt,
    licenseKeys: [],
    deliveryStatus: 'sent',
  }

  for (let index = 0; index < input.packSize; index += 1) {
    order.licenseKeys.push(input.issuer.issue(order, index))
  }

  const manual: ManualOrder = {
    id: orderId,
    tier: input.tier,
    packSize: input.packSize,
    seats: input.seats,
    price: input.price,
    currency: 'USD',
    createdAt,
    licenseKeys: order.licenseKeys,
  }
  if (input.buyer?.trim()) manual.buyer = input.buyer.trim()
  if (input.note?.trim()) manual.note = input.note.trim()

  await writeOrders(input.dataDir, [...existing, manual])
  return manual
}

export async function listManualOrders(dataDir: string): Promise<ManualOrder[]> {
  return readOrders(dataDir)
}
