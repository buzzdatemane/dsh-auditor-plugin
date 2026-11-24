import { randomUUID } from 'node:crypto'
import type {
  CreateInvoiceInput,
  Invoice,
  PaymentProvider,
} from '../types.js'

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const

  constructor(private readonly baseUrl: string) {}

  async createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
    const id = `mock_${randomUUID()}`
    return {
      id,
      checkoutUrl: `${this.baseUrl}/mock-checkout?invoice=${encodeURIComponent(id)}`,
    }
  }
}
