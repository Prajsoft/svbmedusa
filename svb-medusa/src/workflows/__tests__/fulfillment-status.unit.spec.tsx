import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { transitionFulfillmentStatusWorkflow } from "../fulfillment-status"

function makeOrderWithRequestedIntent() {
  return {
    id: "order_01",
    metadata: {
      fulfillment_state_v1: "requested",
      fulfillment_intents_v1: {
        "order_01:1": {
          idempotency_key: "order_01:1",
          fulfillment_attempt: 1,
          state: "requested",
          requested_at: "2026-02-19T00:00:00.000Z",
          shipment_contract_summary: {
            pickup_location_code: "WH-MRT-01",
            package_count: 1,
            total_weight_grams: 160,
            cod: { enabled: true, amount: 1499 },
            invoice_ref: "1001",
          },
        },
      },
    } as Record<string, unknown>,
  } as { id: string; metadata: Record<string, unknown> }
}

describe("transitionFulfillmentStatusWorkflow", () => {
  it("applies allowed transitions and emits audit event", async () => {
    const order = makeOrderWithRequestedIntent()

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

    const toReady = await transitionFulfillmentStatusWorkflow(scope as any, {
      order_id: "order_01",
      to_status: "ready_for_shipment",
      actor_id: "admin_01",
    })
    const toShipped = await transitionFulfillmentStatusWorkflow(scope as any, {
      order_id: "order_01",
      to_status: "shipped",
      actor_id: "admin_01",
    })
    const toDelivered = await transitionFulfillmentStatusWorkflow(scope as any, {
      order_id: "order_01",
      to_status: "delivered",
      actor_id: "admin_01",
    })

    expect(toReady.changed).toBe(true)
    expect(toReady.from_status).toBe("requested")
    expect(toReady.to_status).toBe("ready_for_shipment")
    expect(toShipped.changed).toBe(true)
    expect(toShipped.from_status).toBe("ready_for_shipment")
    expect(toShipped.to_status).toBe("shipped")
    expect(toDelivered.changed).toBe(true)
    expect(toDelivered.from_status).toBe("shipped")
    expect(toDelivered.to_status).toBe("delivered")

    expect(orderModule.updateOrders).toHaveBeenCalledTimes(3)
    expect(eventBus.emit).toHaveBeenCalledTimes(3)
    expect(eventBus.emit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: "fulfillment.status_changed",
        data: expect.objectContaining({
          order_id: "order_01",
          from_status: "requested",
          to_status: "ready_for_shipment",
        }),
      })
    )
  })

  it("is idempotent when target status equals current status", async () => {
    const order = makeOrderWithRequestedIntent()

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

    await transitionFulfillmentStatusWorkflow(scope as any, {
      order_id: "order_01",
      to_status: "ready_for_shipment",
      actor_id: "admin_01",
    })
    const replay = await transitionFulfillmentStatusWorkflow(scope as any, {
      order_id: "order_01",
      to_status: "ready_for_shipment",
      actor_id: "admin_01",
    })

    expect(replay.changed).toBe(false)
    expect(orderModule.updateOrders).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledTimes(1)
  })

  it("rejects invalid state moves", async () => {
    const order = makeOrderWithRequestedIntent()

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
      transitionFulfillmentStatusWorkflow(scope as any, {
        order_id: "order_01",
        to_status: "shipped",
      })
    ).rejects.toMatchObject({
      code: "INVALID_FULFILLMENT_STATUS_TRANSITION",
    })

    expect(orderModule.updateOrders).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
  })
})
