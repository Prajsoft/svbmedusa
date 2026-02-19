import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { rtoCloseWorkflow } from "../rto_close"
import { rtoInitiateWorkflow } from "../rto_initiate"
import { rtoQcFailWorkflow } from "../rto_qc_fail"
import { rtoQcPassWorkflow } from "../rto_qc_pass"
import { rtoReceiveWorkflow } from "../rto_receive"

function makeHarness(input?: { prepaid?: boolean; codCaptured?: boolean }) {
  const prepaid = input?.prepaid ?? false
  const codCaptured = input?.codCaptured ?? false

  const order = {
    id: "order_01",
    metadata: {},
    items: [
      {
        id: "item_01",
        title: "Swift Plus Ball",
        quantity: 2,
        variant: {
          id: "var_01",
          sku: "SVB-CRB-SWFP-WHT-P01",
          title: "Swift Plus Ball",
        },
      },
    ],
    payment_collections: [
      {
        payments: prepaid
          ? [
              {
                id: "pay_pre_01",
                provider_id: "pp_razorpay",
                amount: 1499,
                captured_at: "2026-02-19T00:00:00.000Z",
                data: {},
              },
            ]
          : [
              {
                id: "pay_cod_01",
                provider_id: "pp_cod_cod",
                amount: 1499,
                captured_at: codCaptured ? "2026-02-19T00:00:00.000Z" : null,
                data: { cod_state: codCaptured ? "captured" : "authorized" },
              },
            ],
      },
    ],
  }

  const variants = {
    var_01: {
      id: "var_01",
      sku: "SVB-CRB-SWFP-WHT-P01",
      inventory_items: [
        {
          inventory_item_id: "iitem_01",
          required_quantity: 1,
        },
      ],
    },
  }

  const stockLocations = [
    { id: "loc_sellable", name: "WH-MRT-01" },
    { id: "loc_qc_hold", name: "QC_HOLD" },
    { id: "loc_damage", name: "DAMAGE" },
  ]

  const inventoryLedger = new Map<string, number>()

  const query = {
    graph: jest.fn(async (input: { entity: string; filters?: Record<string, unknown> }) => {
      if (input.entity === "order") {
        const id = String(input.filters?.id ?? "")
        return { data: id === order.id ? [order] : [] }
      }

      if (input.entity === "variant") {
        const id = String(input.filters?.id ?? "")
        const variant = variants[id as keyof typeof variants]
        return { data: variant ? [variant] : [] }
      }

      if (input.entity === "stock_location") {
        return { data: stockLocations }
      }

      throw new Error(`Unexpected query entity: ${input.entity}`)
    }),
  }

  const orderModule = {
    updateOrders: jest.fn(async (_id: string, input: { metadata: Record<string, unknown> }) => {
      order.metadata = input.metadata
      return order
    }),
  }

  const inventoryModule = {
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
    capturePayment: jest.fn(async () => undefined),
  }

  const paymentModule = {
    capturePayment: jest.fn(async () => undefined),
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
      if (key === Modules.PAYMENT) {
        return paymentModule
      }

      throw new Error(`Unknown key: ${key}`)
    },
  }

  return {
    scope,
    order,
    inventoryModule,
    paymentModule,
    eventBus,
    inventoryLedger,
  }
}

describe("rto workflows", () => {
  it("applies RTO transitions and inventory movements (qc_pass restocks)", async () => {
    const harness = makeHarness()

    await rtoInitiateWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "init-1",
    })
    await rtoReceiveWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "receive-1",
    })
    await rtoQcPassWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "qcpass-1",
    })
    await rtoCloseWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "close-1",
    })

    expect((harness.order.metadata as Record<string, unknown>).rto_state_v1).toBe(
      "closed"
    )

    expect(harness.inventoryModule.adjustInventory).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([
        expect.objectContaining({
          inventoryItemId: "iitem_01",
          locationId: "loc_qc_hold",
          adjustment: 2,
        }),
      ])
    )
    expect(harness.inventoryModule.adjustInventory).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        expect.objectContaining({
          inventoryItemId: "iitem_01",
          locationId: "loc_qc_hold",
          adjustment: -2,
        }),
        expect.objectContaining({
          inventoryItemId: "iitem_01",
          locationId: "loc_sellable",
          adjustment: 2,
        }),
      ])
    )
    expect(harness.paymentModule.capturePayment).not.toHaveBeenCalled()
  })

  it("qc_fail writes off inventory to DAMAGE", async () => {
    const harness = makeHarness()

    await rtoInitiateWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "init-1",
    })
    await rtoReceiveWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "receive-1",
    })
    await rtoQcFailWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "qcfail-1",
    })

    expect(harness.inventoryModule.adjustInventory).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        expect.objectContaining({
          inventoryItemId: "iitem_01",
          locationId: "loc_qc_hold",
          adjustment: -2,
        }),
        expect.objectContaining({
          inventoryItemId: "iitem_01",
          locationId: "loc_damage",
          adjustment: 2,
        }),
      ])
    )
  })

  it("blocks RTO initiate when COD is already captured", async () => {
    const harness = makeHarness({ codCaptured: true })

    await expect(
      rtoInitiateWorkflow(harness.scope as any, {
        order_id: "order_01",
        idempotency_key: "init-1",
      })
    ).rejects.toMatchObject({
      code: "COD_CAPTURE_NOT_ALLOWED_FOR_RTO",
    })
  })

  it("emits prepaid refund stub event on qc_pass for prepaid orders", async () => {
    const harness = makeHarness({ prepaid: true })

    await rtoInitiateWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "init-1",
    })
    await rtoReceiveWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "receive-1",
    })
    await rtoQcPassWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "qcpass-1",
    })

    expect(harness.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "rto.prepaid_refund_pending",
        data: expect.objectContaining({
          order_id: "order_01",
          rto_id: "rto_1",
          stage: "qc_passed",
        }),
      })
    )
  })
})
