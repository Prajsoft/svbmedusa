import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { exchangeApproveWorkflow } from "../exchange_approve"
import { exchangeCloseWorkflow } from "../exchange_close"
import { exchangeReceiveReturnWorkflow } from "../exchange_receive_return"
import { exchangeRequestWorkflow } from "../exchange_request"
import { exchangeReserveReplacementWorkflow } from "../exchange_reserve_replacement"
import { exchangeShipReplacementWorkflow } from "../exchange_ship_replacement"

function makeHarness() {
  const order = {
    id: "order_01",
    metadata: {},
    items: [
      {
        id: "item_01",
        title: "Swift Plus Ball",
        quantity: 1,
        variant: {
          id: "var_01",
          sku: "SVB-CRB-SWFP-WHT-P01",
          title: "Swift Plus Ball",
        },
      },
    ],
  }

  const variants = {
    var_01: {
      id: "var_01",
      sku: "SVB-CRB-SWFP-WHT-P01",
      title: "Swift Plus Ball",
      inventory_items: [{ inventory_item_id: "iitem_01", required_quantity: 1 }],
    },
    var_02: {
      id: "var_02",
      sku: "SVB-CRB-BLTZP-RED-P12",
      title: "Blitz Plus Ball",
      inventory_items: [{ inventory_item_id: "iitem_02", required_quantity: 1 }],
    },
  }

  const stockLocations = [
    { id: "loc_sellable", name: "WH-MRT-01" },
    { id: "loc_qc_hold", name: "QC_HOLD" },
    { id: "loc_exchange_hold", name: "EXCHANGE_HOLD" },
  ]

  const availableByKey = new Map<string, number>([
    ["iitem_01:loc_sellable", 20],
    ["iitem_02:loc_sellable", 2],
  ])

  const inventoryLedger = new Map<string, number>()

  const query = {
    graph: jest.fn(
      async (input: {
        entity: string
        fields?: string[]
        filters?: Record<string, unknown>
      }) => {
        if (input.entity === "order") {
          const id = String(input.filters?.id ?? "")
          return { data: id === order.id ? [order] : [] }
        }

        if (input.entity === "variant") {
          const byId = String(input.filters?.id ?? "")
          const bySku = String(input.filters?.sku ?? "")

          if (byId && variants[byId as keyof typeof variants]) {
            return { data: [variants[byId as keyof typeof variants]] }
          }

          const variant = Object.values(variants).find((entry) => entry.sku === bySku)
          return { data: variant ? [variant] : [] }
        }

        if (input.entity === "stock_location") {
          return { data: stockLocations }
        }

        throw new Error(`Unexpected query entity: ${input.entity}`)
      }
    ),
  }

  const orderModule = {
    updateOrders: jest.fn(async (_id: string, input: { metadata: Record<string, unknown> }) => {
      order.metadata = input.metadata
      return order
    }),
  }

  const inventoryModule = {
    retrieveAvailableQuantity: jest.fn(async (inventoryItemId: string, locationIds: string[]) => {
      const key = `${inventoryItemId}:${locationIds[0]}`
      return availableByKey.get(key) ?? 0
    }),
    adjustInventory: jest.fn(
      async (
        payload:
          | Array<{ inventoryItemId: string; locationId: string; adjustment: number }>
          | { inventoryItemId: string; locationId: string; adjustment: number }
      ) => {
        const rows = Array.isArray(payload) ? payload : [payload]
        for (const row of rows) {
          const key = `${row.inventoryItemId}:${row.locationId}`
          const current = inventoryLedger.get(key) ?? 0
          inventoryLedger.set(key, current + Number(row.adjustment))
        }
      }
    ),
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
      if (key === Modules.INVENTORY) {
        return inventoryModule
      }
      if (key === Modules.EVENT_BUS) {
        return eventBus
      }

      throw new Error(`Unknown key: ${key}`)
    },
  }

  return {
    scope,
    order,
    query,
    availableByKey,
    inventoryModule,
    inventoryLedger,
    eventBus,
  }
}

describe("exchange workflows", () => {
  it("cannot reserve replacement if inventory is insufficient", async () => {
    const harness = makeHarness()
    harness.availableByKey.set("iitem_02:loc_sellable", 0)

    await exchangeRequestWorkflow(harness.scope as any, {
      order_id: "order_01",
      exchange_id: "exchange_1",
      idempotency_key: "req-1",
      reason_code: "SIZE_ISSUE",
      replacement_items: [{ variant_id: "var_02", quantity: 1 }],
    })
    await exchangeApproveWorkflow(harness.scope as any, {
      order_id: "order_01",
      exchange_id: "exchange_1",
      idempotency_key: "approve-1",
    })
    await exchangeReceiveReturnWorkflow(harness.scope as any, {
      order_id: "order_01",
      exchange_id: "exchange_1",
      idempotency_key: "receive-1",
    })

    await expect(
      exchangeReserveReplacementWorkflow(harness.scope as any, {
        order_id: "order_01",
        exchange_id: "exchange_1",
        idempotency_key: "reserve-1",
      })
    ).rejects.toMatchObject({
      code: "OUT_OF_STOCK",
      message: expect.stringContaining("SVB-CRB-BLTZP-RED-P12"),
    })
  })

  it("enforces transition order and idempotency on reserve", async () => {
    const harness = makeHarness()

    await exchangeRequestWorkflow(harness.scope as any, {
      order_id: "order_01",
      exchange_id: "exchange_1",
      idempotency_key: "req-1",
      reason_code: "WRONG_ITEM",
      replacement_items: [{ variant_id: "var_02", quantity: 1 }],
    })
    await exchangeApproveWorkflow(harness.scope as any, {
      order_id: "order_01",
      exchange_id: "exchange_1",
      idempotency_key: "approve-1",
    })

    await expect(
      exchangeReserveReplacementWorkflow(harness.scope as any, {
        order_id: "order_01",
        exchange_id: "exchange_1",
        idempotency_key: "reserve-invalid",
      })
    ).rejects.toMatchObject({
      code: "INVALID_EXCHANGE_STATE_TRANSITION",
    })

    await exchangeReceiveReturnWorkflow(harness.scope as any, {
      order_id: "order_01",
      exchange_id: "exchange_1",
      idempotency_key: "receive-1",
    })

    const first = await exchangeReserveReplacementWorkflow(harness.scope as any, {
      order_id: "order_01",
      exchange_id: "exchange_1",
      idempotency_key: "reserve-1",
    })
    const replay = await exchangeReserveReplacementWorkflow(harness.scope as any, {
      order_id: "order_01",
      exchange_id: "exchange_1",
      idempotency_key: "reserve-1",
    })

    expect(first.changed).toBe(true)
    expect(replay.changed).toBe(false)

    const reserveEvents = harness.eventBus.emit.mock.calls
      .map((call: any[]) => call[0])
      .filter((entry: { name?: string }) => entry.name === "exchange.replacement_reserved")
    expect(reserveEvents).toHaveLength(1)
  })

  it("exchange close is blocked until replacement shipped or delivered", async () => {
    const harness = makeHarness()

    await exchangeRequestWorkflow(harness.scope as any, {
      order_id: "order_01",
      exchange_id: "exchange_1",
      idempotency_key: "req-1",
      reason_code: "OTHER",
      replacement_items: [{ variant_id: "var_02", quantity: 1 }],
    })
    await exchangeApproveWorkflow(harness.scope as any, {
      order_id: "order_01",
      exchange_id: "exchange_1",
      idempotency_key: "approve-1",
    })
    await exchangeReceiveReturnWorkflow(harness.scope as any, {
      order_id: "order_01",
      exchange_id: "exchange_1",
      idempotency_key: "receive-1",
    })
    await exchangeReserveReplacementWorkflow(harness.scope as any, {
      order_id: "order_01",
      exchange_id: "exchange_1",
      idempotency_key: "reserve-1",
    })

    await expect(
      exchangeCloseWorkflow(harness.scope as any, {
        order_id: "order_01",
        exchange_id: "exchange_1",
        idempotency_key: "close-before-ship",
      })
    ).rejects.toMatchObject({
      code: "EXCHANGE_CLOSE_BLOCKED",
    })

    await exchangeShipReplacementWorkflow(harness.scope as any, {
      order_id: "order_01",
      exchange_id: "exchange_1",
      idempotency_key: "ship-1",
    })
    const close = await exchangeCloseWorkflow(harness.scope as any, {
      order_id: "order_01",
      exchange_id: "exchange_1",
      idempotency_key: "close-1",
    })

    expect(close.changed).toBe(true)
    expect(close.to_state).toBe("closed")
    expect((harness.order.metadata as Record<string, unknown>).exchange_state_v1).toBe(
      "closed"
    )
  })
})
