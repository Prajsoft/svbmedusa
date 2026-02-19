import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { fulfillmentRequestWorkflow } from "../fulfillment_request"
import {
  __resetMetricsForTests,
  getMetricsSnapshot,
} from "../../modules/observability/metrics"

function makeOrder() {
  return {
    id: "order_01",
    display_id: 1001,
    total: 1499,
    metadata: {},
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
        payments: [{ provider_id: "pp_cod_cod", amount: 1499 }],
      },
    ],
  }
}

describe("fulfillmentRequestWorkflow", () => {
  beforeEach(() => {
    __resetMetricsForTests()
  })

  it("creates fulfillment intent and emits fulfillment.requested", async () => {
    const order = makeOrder()

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

        throw new Error(`Unknown container key: ${key}`)
      },
    }

    const result = await fulfillmentRequestWorkflow(scope as any, {
      order_id: "order_01",
    })

    expect(result.created).toBe(true)
    expect(result.idempotency_key).toBe("order_01:1")
    expect(orderModule.updateOrders).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "fulfillment.requested",
        data: expect.objectContaining({
          order_id: "order_01",
          shipment_contract_summary: expect.objectContaining({
            package_count: 1,
            cod: {
              enabled: true,
              amount: 1499,
            },
          }),
        }),
      })
    )

    const snapshot = getMetricsSnapshot()
    const durationMetric = snapshot.timers.find(
      (entry) => entry.name === "workflow.fulfillment_request.duration_ms"
    )
    expect(durationMetric).toEqual(
      expect.objectContaining({
        count: 1,
        labels: expect.objectContaining({
          workflow: "fulfillment_request",
          result: "success",
          order_id: "order_01",
        }),
      })
    )

    const successCounter = snapshot.counters.find(
      (entry) => entry.name === "workflow.fulfillment_request.success_total"
    )
    expect(successCounter).toEqual(
      expect.objectContaining({
        labels: expect.objectContaining({
          workflow: "fulfillment_request",
          result: "success",
          order_id: "order_01",
        }),
        value: 1,
      })
    )
  })

  it("re-run with same order and attempt does not duplicate intent or event", async () => {
    const order = makeOrder()

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

        throw new Error(`Unknown container key: ${key}`)
      },
    }

    const first = await fulfillmentRequestWorkflow(scope as any, {
      order_id: "order_01",
      fulfillment_attempt: 1,
    })
    const second = await fulfillmentRequestWorkflow(scope as any, {
      order_id: "order_01",
      fulfillment_attempt: 1,
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(orderModule.updateOrders).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledTimes(1)
  })

  it("contract build failure prevents persistence and event emission", async () => {
    const order = makeOrder()
    ;(order.items[0].variant.metadata as Record<string, unknown>).weight_grams = undefined

    const query = {
      graph: jest.fn(async () => ({ data: [order] })),
    }

    const orderModule = {
      updateOrders: jest.fn(async () => order),
    }

    const eventBus = {
      emit: jest.fn(async () => undefined),
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

        throw new Error(`Unknown container key: ${key}`)
      },
    }

    await expect(
      fulfillmentRequestWorkflow(scope as any, { order_id: "order_01" })
    ).rejects.toMatchObject({
      code: "MISSING_LOGISTICS_METADATA",
    })

    expect(orderModule.updateOrders).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()

    const snapshot = getMetricsSnapshot()
    const failureCounter = snapshot.counters.find(
      (entry) =>
        entry.name === "workflow.fulfillment_request.failure_total" &&
        entry.labels?.error_code === "MISSING_LOGISTICS_METADATA"
    )
    expect(failureCounter).toEqual(
      expect.objectContaining({
        labels: expect.objectContaining({
          workflow: "fulfillment_request",
          result: "failure",
          order_id: "order_01",
          error_code: "MISSING_LOGISTICS_METADATA",
        }),
        value: 1,
      })
    )
  })
})
