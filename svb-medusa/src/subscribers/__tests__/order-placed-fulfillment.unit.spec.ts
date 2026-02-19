import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  __resetProcessedOrdersForTests,
  createOrderPlacedHandler,
} from "../order-placed"

describe("order.placed fulfillment wiring", () => {
  beforeEach(() => {
    __resetProcessedOrdersForTests()
  })

  it("order.placed creates fulfillment intent in order metadata", async () => {
    const orderId = "order_success_01"
    const orderRecord: { id: string; metadata: Record<string, unknown>; [key: string]: unknown } = {
      id: orderId,
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
          id: "item_1",
          title: "Swift Plus Ball",
          quantity: 1,
          variant: {
            id: "var_1",
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
          payments: [{ provider_id: "pp_cod_cod", amount: 1499 }],
        },
      ],
    }

    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }

    const query = {
      graph: jest.fn(async () => ({ data: [orderRecord] })),
    }

    const orderModule = {
      updateOrders: jest.fn(async (_id: string, data: { metadata: Record<string, unknown> }) => {
        orderRecord.metadata = data.metadata
        return orderRecord
      }),
    }

    const eventBus = {
      emit: jest.fn(async () => undefined),
    }

    const container = {
      resolve: (key: string) => {
        if (key === "logger") {
          return logger
        }
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

    const sendOrderConfirmation = jest.fn(async () => undefined)
    const handler = createOrderPlacedHandler({ sendOrderConfirmation })

    await expect(
      handler({
        event: { data: { id: orderId } },
        container,
      } as any)
    ).resolves.toBeUndefined()

    expect(orderModule.updateOrders).toHaveBeenCalledTimes(1)
    expect(orderRecord.metadata.fulfillment_state_v1).toBe("requested")
    const intents = orderRecord.metadata.fulfillment_intents_v1 as Record<
      string,
      { state?: string }
    >
    expect(intents?.["order_success_01:1"]?.state).toBe("requested")
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "fulfillment.requested",
      })
    )
    expect(eventBus.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: "fulfillment.request_failed",
      })
    )
  })

  it("does not fail order flow when fulfillment request fails; marks pending and alerts ops", async () => {
    const orderId = "order_fail_01"
    const orderRecord: { id: string; metadata: Record<string, unknown> } = {
      id: orderId,
      metadata: { existing: true },
    }

    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }

    const query = {
      graph: jest.fn(async () => ({ data: [orderRecord] })),
    }

    const orderModule = {
      updateOrders: jest.fn(async (_id: string, data: { metadata: Record<string, unknown> }) => {
        orderRecord.metadata = data.metadata
        return orderRecord
      }),
    }

    const eventBus = {
      emit: jest.fn(async () => undefined),
    }

    const container = {
      resolve: (key: string) => {
        if (key === "logger") {
          return logger
        }
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

    const sendOrderConfirmation = jest.fn(async () => undefined)
    const runFulfillmentRequest = jest.fn(async () => {
      const error = new Error("contract build failed")
      ;(error as Error & { code: string }).code = "MISSING_LOGISTICS_METADATA"
      throw error
    })

    const handler = createOrderPlacedHandler({
      sendOrderConfirmation,
      runFulfillmentRequest,
    })

    await expect(
      handler({
        event: { data: { id: orderId } },
        container,
      } as any)
    ).resolves.toBeUndefined()

    expect(sendOrderConfirmation).toHaveBeenCalledTimes(1)
    expect(runFulfillmentRequest).toHaveBeenCalledTimes(1)
    expect(orderModule.updateOrders).toHaveBeenCalledTimes(1)
    expect(orderModule.updateOrders).toHaveBeenCalledWith(
      orderId,
      expect.objectContaining({
        metadata: expect.objectContaining({
          fulfillment_state_v1: "pending",
          fulfillment_last_error_v1: expect.objectContaining({
            code: "MISSING_LOGISTICS_METADATA",
          }),
        }),
      })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "fulfillment.request_failed",
        data: expect.objectContaining({
          order_id: orderId,
          code: "MISSING_LOGISTICS_METADATA",
        }),
      })
    )
  })
})
