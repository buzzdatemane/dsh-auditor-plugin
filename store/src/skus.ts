import type { Sku } from './types.js'

/**
 * Micro-priced SKUs. The 10-pack is the primary product: one payment covers
 * network/support costs while keeping the per-license price at $0.99.
 */
export const SKUS: readonly Sku[] = [
  {
    id: 'pro-1',
    tier: 'pro',
    packSize: 1,
    seats: 1,
    amount: 0.99,
    currency: 'USD',
    label: 'Pro ×1',
    description: 'One annual Pro license for one developer.',
  },
  {
    id: 'pro-10',
    tier: 'pro',
    packSize: 10,
    seats: 1,
    amount: 9.9,
    currency: 'USD',
    label: 'Pro ×10',
    description: 'Ten annual Pro licenses — the primary pack.',
  },
  {
    id: 'team-5',
    tier: 'team',
    packSize: 1,
    seats: 5,
    amount: 2.99,
    currency: 'USD',
    label: 'Team ×5',
    description: 'One annual Team license for up to five developers.',
  },
  {
    id: 'lifetime-1',
    tier: 'lifetime',
    packSize: 1,
    seats: 1,
    amount: 1.99,
    currency: 'USD',
    label: 'Lifetime ×1',
    description: 'One lifetime Pro license. First 100 buyers.',
  },
]

export function findSku(id: string): Sku | undefined {
  return SKUS.find((sku) => sku.id === id)
}
