import crypto from "crypto"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import * as razorpayClientModule from "../client"
import { RazorpayContractProvider } from "../contract-provider"
import RazorpayPaymentProviderService from "../service"
import { runProviderContractSuite } from "../../../../payments/tests/providerContractSuite"
import { PaymentStatus } from "../../../../payments/types"

jest.mock("../client", () => {
  const actual = jest.requireActual("../client")
  return {
    ...actual,
    getRazorpayClient: jest.fn(),
  }
})

type PgMockState = {
  sessionOrders: Map<
    string,
    {
      orderId: string
      amount: number
      currency: string
      attemptCount: number
    }
  >
}

const getRazorpayClientMock = razorpayClientModule.getRazorpayClient as jest.Mock

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value)
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.round(parsed)
    }
  }

  return 0
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {}
  }

  return value as Record<string, unknown>
}

function buildPgConnectionMock(state: PgMockState) {
  const raw = jest.fn(async (query: string, bindings: unknown[] = []) => {
    if (query.includes("CREATE TABLE") || query.includes("CREATE INDEX")) {
      return { rows: [] }
    }

    if (query.includes("ALTER TABLE") || query.includes("UPDATE razorpay_session_order_v1")) {
      return { rows: [] }
    }

    if (query.includes("pg_advisory_xact_lock")) {
      return { rows: [] }
    }

    if (
      query.includes("FROM razorpay_session_order_v1") &&
      query.includes("payment_session_id = ?") &&
      query.includes("SELECT")
    ) {
      const sessionId = String(bindings[0] ?? "")
      const record = state.sessionOrders.get(sessionId)
      if (!record) {
        return { rows: [] }
      }

      if (query.includes("attempt_count")) {
        return {
          rows: [
            {
              razorpay_order_id: record.orderId,
              amount: record.amount,
              currency_code: record.currency,
              attempt_count: record.attemptCount,
            },
          ],
        }
      }

      return {
        rows: [{ razorpay_order_id: record.orderId }],
      }
    }

    if (query.includes("INSERT INTO razorpay_session_order_v1")) {
      const sessionId = String(bindings[0] ?? "")
      const orderId = String(bindings[1] ?? "")
      const amount = Number(bindings[2] ?? 0)
      const currency = String(bindings[3] ?? "INR")
      if (!state.sessionOrders.has(sessionId)) {
        state.sessionOrders.set(sessionId, {
          orderId,
          amount: Number.isFinite(amount) ? amount : 0,
          currency,
          attemptCount: 1,
        })
      }
      return { rows: [] }
    }

    if (query.includes("SELECT payment_session_id FROM razorpay_session_order_v1")) {
      const orderId = String(bindings[0] ?? "")
      const match = Array.from(state.sessionOrders.entries()).find(
        ([, stored]) => stored.orderId === orderId
      )

      return {
        rows: match ? [{ payment_session_id: match[0] }] : [],
      }
    }

    return { rows: [] }
  })

  const trx: any = {
    raw,
    transaction: async (handler: (trxArg: any) => Promise<unknown>) => handler(trx),
  }

  return {
    raw,
    transaction: async (handler: (trxArg: any) => Promise<unknown>) =>
      handler(trx),
  }
}

function makeRazorpayService(): RazorpayPaymentProviderService {
  const state: PgMockState = {
    sessionOrders: new Map<
      string,
      {
        orderId: string
        amount: number
        currency: string
        attemptCount: number
      }
    >(),
  }
  const pgConnection = buildPgConnectionMock(state)
  let orderCounter = 0
  const client: razorpayClientModule.RazorpayClient = {
    orders: {
      create: jest.fn(async () => ({
        id: `order_contract_${++orderCounter}`,
      })),
    },
    payments: {
      fetch: jest.fn(async () => ({})),
      capture: jest.fn(async () => ({})),
      refund: jest.fn(async () => ({})),
    },
  }

  getRazorpayClientMock.mockReturnValue(client)

  return new RazorpayPaymentProviderService(
    {
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
      [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection,
    } as any,
    {
      key_id: "rzp_test_abc123",
      key_secret: "secret_test_key",
      payments_mode: "test",
      webhook_secret: "whsec_test_123",
      test_auto_authorize: true,
    }
  )
}

afterEach(() => {
  jest.resetAllMocks()
})

runProviderContractSuite({
  providerName: "razorpay",
  createProvider: async () =>
    new RazorpayContractProvider(makeRazorpayService()),
  buildInitiateInput: () => ({
    payment_session_id: "ps_contract_1",
    cart_id: "cart_contract_1",
    amount: 1499,
    currency: "INR",
    customer: {
      name: "Contract User",
      email: "contract@example.com",
      phone: "9876543210",
    },
    correlation_id: "11111111-1111-4111-8111-111111111111",
  }),
  buildAuthorizeInput: ({ initiate_input, initiate_output }) => {
    const orderId =
      readText(initiate_output.provider_refs.provider_order_id) ||
      readText(
        readRecord(initiate_output.provider_session_data).razorpay_order_id
      )
    const paymentId = "pay_contract_001"
    const signature = crypto
      .createHmac("sha256", "secret_test_key")
      .update(`${orderId}|${paymentId}`)
      .digest("hex")

    return {
      payment_session_id: initiate_input.payment_session_id,
      cart_id: initiate_input.cart_id,
      provider_payload: {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      },
      provider_order_id: orderId,
      provider_payment_id: paymentId,
      provider_signature: signature,
      correlation_id: "22222222-2222-4222-8222-222222222222",
    }
  },
  buildReauthorizeInput: ({
    first_authorize_input,
    first_authorize_output,
  }) => ({
    ...first_authorize_input,
    provider_payload: first_authorize_output.provider_session_data,
    provider_order_id:
      first_authorize_output.provider_refs.provider_order_id ||
      first_authorize_input.provider_order_id,
    provider_payment_id:
      first_authorize_output.provider_refs.provider_payment_id ||
      first_authorize_input.provider_payment_id,
    provider_signature: undefined,
    correlation_id: "33333333-3333-4333-8333-333333333333",
  }),
  buildMappedErrorCase: async (provider) =>
    provider.initiatePayment({
      payment_session_id: "ps_contract_error_1",
      cart_id: "cart_contract_error_1",
      amount: 1499,
      currency: "USD",
      correlation_id: "44444444-4444-4444-8444-444444444444",
    }),
  buildRefundInput: ({ initiate_input, initiate_output }) => ({
    payment_session_id: initiate_input.payment_session_id,
    cart_id: initiate_input.cart_id,
    amount: initiate_input.amount,
    currency: initiate_input.currency,
    provider_refs: {
      provider_order_id: initiate_output.provider_refs.provider_order_id,
      provider_payment_id: initiate_output.provider_refs.provider_payment_id,
    },
    correlation_id: "55555555-5555-4555-8555-555555555555",
  }),
  expectedAuthorizeStatus: PaymentStatus.AUTHORIZED,
  requiredProviderRefKeys: ["provider_order_id"],
})
