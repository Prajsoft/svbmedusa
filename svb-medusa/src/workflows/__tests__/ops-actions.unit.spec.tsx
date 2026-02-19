import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

jest.mock("../fulfillment_request", () => ({
  fulfillmentRequestWorkflow: jest.fn(),
}))

jest.mock("../cod/admin-operations", () => ({
  captureCodPaymentWorkflow: jest.fn(),
  recordCodRefundWorkflow: jest.fn(),
}))

import { fulfillmentRequestWorkflow } from "../fulfillment_request"
import {
  captureCodPaymentWorkflow,
  recordCodRefundWorkflow,
} from "../cod/admin-operations"
import {
  markCodCapturedActionWorkflow,
  rebuildShipmentContractActionWorkflow,
  recordCodRefundActionWorkflow,
  retryFulfillmentActionWorkflow,
} from "../ops/actions"

type MutableOrder = {
  id: string
  display_id: number
  total: number
  metadata: Record<string, unknown>
  shipping_address: Record<string, unknown>
  items: Array<{
    id: string
    title: string
    quantity: number
    variant: {
      id: string
      sku: string
      title: string
      metadata: Record<string, unknown>
    }
  }>
  payment_collections: Array<{
    payments: Array<{
      id: string
      provider_id: string
      amount: number
      captured_at: string | null
      data: Record<string, unknown>
    }>
  }>
}

function makeOrder(): MutableOrder {
  return {
    id: "order_01",
    display_id: 1001,
    total: 1499,
    metadata: {
      fulfillment_intents_v1: {
        "order_01:1": {
          fulfillment_attempt: 1,
          state: "delivery_failed",
          requested_at: "2026-02-18T10:00:00.000Z",
          shipment_contract_summary: {
            pickup_location_code: "WH-MRT-01",
            package_count: 1,
            total_weight_grams: 100,
            cod: { enabled: true, amount: 1499 },
            invoice_ref: "1001",
          },
        },
      },
    },
    shipping_address: {
      first_name: "Prash",
      last_name: "K",
      phone: "9999999999",
      address_1: "Street 1",
      city: "Chennai",
      province: "TN",
      postal_code: "600001",
      country_code: "IN",
    },
    items: [
      {
        id: "item_01",
        title: "Swift Plus Ball",
        quantity: 1,
        variant: {
          id: "var_01",
          sku: "SVB-CRB-SWFP-WHT-P01",
          title: "Swift Plus Ball",
          metadata: {
            weight_grams: 160,
            dimensions_cm: { l: 10, w: 6, h: 4 },
            shipping_class: "SMALL",
          },
        },
      },
    ],
    payment_collections: [
      {
        payments: [
          {
            id: "pay_cod_01",
            provider_id: "pp_cod_cod",
            amount: 1499,
            captured_at: null,
            data: { cod_state: "authorized" },
          },
        ],
      },
    ],
  }
}

function makeScope(order: MutableOrder) {
  const query = {
    graph: jest.fn(async () => ({ data: [order] })),
  }

  const orderModule = {
    updateOrders: jest.fn(async (_id: string, data: { metadata: Record<string, unknown> }) => {
      order.metadata = data.metadata
      return order
    }),
  }

  const eventBus = {
    emit: jest.fn(async () => undefined),
  }

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }

  const scope = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) {
        return query
      }
      if (key === Modules.ORDER) {
        return orderModule
      }
      if (key === Modules.EVENT_BUS) {
        return eventBus
      }
      if (key === ContainerRegistrationKeys.LOGGER || key === "logger") {
        return logger
      }
      throw new Error(`Unknown key: ${key}`)
    },
  }

  return { scope, query, orderModule, eventBus, logger }
}

describe("ops action workflows", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("retry-fulfillment is idempotent and does not double-apply", async () => {
    const order = makeOrder()
    const harness = makeScope(order)

    ;(fulfillmentRequestWorkflow as jest.Mock).mockImplementation(
      async (_scope: unknown, input: { fulfillment_attempt?: number }) => {
        const attempt = input.fulfillment_attempt ?? 2
        order.metadata = {
          ...(order.metadata ?? {}),
          fulfillment_intents_v1: {
            ...((order.metadata?.fulfillment_intents_v1 as Record<string, unknown>) ?? {}),
            [`order_01:${attempt}`]: {
              fulfillment_attempt: attempt,
              state: "requested",
              requested_at: "2026-02-19T10:00:00.000Z",
              shipment_contract_summary: {
                pickup_location_code: "WH-MRT-01",
                package_count: 1,
                total_weight_grams: 160,
                cod: { enabled: true, amount: 1499 },
                invoice_ref: "1001",
              },
            },
          },
        }

        return {
          order_id: order.id,
          idempotency_key: `order_01:${attempt}`,
          created: true,
        }
      }
    )

    const first = await retryFulfillmentActionWorkflow(harness.scope as any, {
      order_id: "order_01",
      actor_id: "admin_01",
      correlation_id: "corr-retry-1",
    })
    const second = await retryFulfillmentActionWorkflow(harness.scope as any, {
      order_id: "order_01",
      actor_id: "admin_01",
      correlation_id: "corr-retry-1",
    })

    expect(first).toEqual({
      order_id: "order_01",
      status: "applied",
      fulfillment_attempt: 2,
    })
    expect(second).toEqual({
      order_id: "order_01",
      status: "noop",
      fulfillment_attempt: 2,
    })
    expect(fulfillmentRequestWorkflow).toHaveBeenCalledTimes(1)
    expect(harness.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ops.action.executed",
        data: expect.objectContaining({
          action: "retry-fulfillment",
        }),
      })
    )
  })

  it("rebuild-shipment-contract is idempotent and avoids duplicate updates", async () => {
    const order = makeOrder()
    const harness = makeScope(order)

    const first = await rebuildShipmentContractActionWorkflow(harness.scope as any, {
      order_id: "order_01",
      actor_id: "admin_01",
      correlation_id: "corr-rebuild-1",
    })
    const second = await rebuildShipmentContractActionWorkflow(harness.scope as any, {
      order_id: "order_01",
      actor_id: "admin_01",
      correlation_id: "corr-rebuild-1",
    })

    expect(first.status).toBe("applied")
    expect(second.status).toBe("noop")
    expect(first.fulfillment_attempt).toBe(1)
    expect(second.fulfillment_attempt).toBe(1)
    expect(harness.orderModule.updateOrders).toHaveBeenCalledTimes(1)
    expect(harness.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ops.action.executed",
        data: expect.objectContaining({
          action: "rebuild-shipment-contract",
        }),
      })
    )
  })

  it("mark-cod-captured returns noop on repeated invocation", async () => {
    const order = makeOrder()
    const harness = makeScope(order)

    ;(captureCodPaymentWorkflow as jest.Mock)
      .mockResolvedValueOnce({
        order_id: "order_01",
        payment_id: "pay_cod_01",
        already_captured: false,
      })
      .mockResolvedValueOnce({
        order_id: "order_01",
        payment_id: "pay_cod_01",
        already_captured: true,
      })

    const first = await markCodCapturedActionWorkflow(harness.scope as any, {
      order_id: "order_01",
      actor_id: "admin_01",
    })
    const second = await markCodCapturedActionWorkflow(harness.scope as any, {
      order_id: "order_01",
      actor_id: "admin_01",
    })

    expect(first.status).toBe("applied")
    expect(second.status).toBe("noop")
    expect(captureCodPaymentWorkflow).toHaveBeenCalledTimes(2)
  })

  it("record-cod-refund returns noop on repeated invocation", async () => {
    const order = makeOrder()
    const harness = makeScope(order)

    ;(recordCodRefundWorkflow as jest.Mock)
      .mockResolvedValueOnce({
        order_id: "order_01",
        payment_id: "pay_cod_01",
        already_recorded: false,
      })
      .mockResolvedValueOnce({
        order_id: "order_01",
        payment_id: "pay_cod_01",
        already_recorded: true,
      })

    const first = await recordCodRefundActionWorkflow(harness.scope as any, {
      order_id: "order_01",
      amount: 1499,
      reason: "Approved refund",
      actor_id: "admin_01",
    })
    const second = await recordCodRefundActionWorkflow(harness.scope as any, {
      order_id: "order_01",
      amount: 1499,
      reason: "Approved refund",
      actor_id: "admin_01",
    })

    expect(first.status).toBe("applied")
    expect(second.status).toBe("noop")
    expect(recordCodRefundWorkflow).toHaveBeenCalledTimes(2)
  })
})
