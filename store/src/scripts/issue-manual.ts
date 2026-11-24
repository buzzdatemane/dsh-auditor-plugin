/**
 * Manual, zero-infrastructure license issuance.
 *
 * Example:
 *   npm run issue-manual -- --tier pro --pack 10 --buyer @alice
 *   npm run issue-manual -- --list
 */
import path from 'node:path'
import { loadOrCreateLicenseIssuer } from '../license.js'
import {
  defaultPrice,
  defaultSeats,
  issueManualOrder,
  listManualOrders,
} from '../manual.js'
import type { Tier } from '../types.js'

function usage(): void {
  console.log('Usage:')
  console.log('  npm run issue-manual -- --tier <pro|team|lifetime> [options]')
  console.log('  npm run issue-manual -- --list')
  console.log('')
  console.log('Options:')
  console.log('  --pack <n>      number of keys, default 1 (max 100)')
  console.log('  --seats <n>     seats per key, default 1 (team: 5)')
  console.log('  --price <usd>   default from the price table')
  console.log('  --order <id>    custom order id')
  console.log('  --buyer <name>  Telegram username or buyer reference')
  console.log('  --note <text>   internal note')
  console.log('  --json          JSON output')
}

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`)
  return parsed
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {
    // optional
  }

  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    usage()
    return
  }

  const dataDir = path.resolve(process.env.DATA_DIR?.trim() || 'data')

  if (args.includes('--list')) {
    const orders = await listManualOrders(dataDir)
    for (const order of orders) {
      console.log(
        `${order.createdAt}  ${order.id}  ${order.tier} x${order.packSize}  $${order.price.toFixed(2)}  ${order.buyer ?? ''}`,
      )
    }
    console.log(`Total: ${orders.length}`)
    return
  }

  const tierRaw = argValue(args, '--tier')
  if (tierRaw !== 'pro' && tierRaw !== 'team' && tierRaw !== 'lifetime') {
    usage()
    throw new Error('--tier must be pro, team or lifetime')
  }
  const tier = tierRaw as Tier
  const packSize = parseNumber(argValue(args, '--pack'), 1)
  const seats = parseNumber(argValue(args, '--seats'), defaultSeats(tier))
  const price = parseNumber(
    argValue(args, '--price'),
    defaultPrice(tier, packSize),
  )

  const issuer = await loadOrCreateLicenseIssuer(
    dataDir,
    process.env.LICENSE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    process.env.LICENSE_PUBLIC_KEY?.replace(/\\n/g, '\n'),
  )

  const order = await issueManualOrder({
    dataDir,
    issuer,
    tier,
    packSize,
    seats,
    price,
    orderId: argValue(args, '--order'),
    buyer: argValue(args, '--buyer'),
    note: argValue(args, '--note'),
  })

  if (args.includes('--json')) {
    console.log(JSON.stringify(order, null, 2))
    return
  }

  console.log(`Manual order: ${order.id}`)
  console.log(
    `Tier: ${order.tier}, keys: ${order.packSize}, seats: ${order.seats}, price: $${order.price.toFixed(2)}`,
  )
  if (order.buyer) console.log(`Buyer: ${order.buyer}`)
  console.log('')
  console.log('License keys:')
  order.licenseKeys.forEach((key, index) => {
    console.log(`${index + 1}. ${key}`)
  })
  console.log('')
  console.log(`Saved to ${path.join(dataDir, 'manual-orders.json')}`)
  console.log('Send the keys only to the paying buyer; do not post them publicly.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
