import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { returnApproveWorkflow } from "../return_approve"
import { returnCloseWorkflow } from "../return_close"
import { returnQcFailWorkflow } from "../return_qc_fail"
import { returnQcPassWorkflow } from "../return_qc_pass"
import { returnReceiveWorkflow } from "../return_receive"
import { returnRequestWorkflow } from "../return_request"
import {
  __resetMetricsForTests,
  getMetricsSnapshot,
} from "../../../modules/observability/metrics"

function makeHarness() {
  const order = {
    id: "order_01",
    total: 1499,
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
        payments: [
          {
            id: "pay_cod_01",
            provider_id: "pp_cod_cod",
            amount: 1499,
            currency_code: "INR",
            captured_at: "2026-02-18T12:00:00.000Z",
            data: { cod_state: "captured" },
            refunds: [] as Array<{ amount: number; note: string }>,
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
        if (!id || id === order.id) {
          return { data: [order] }
        }

        return { data: [] }
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
        return rows
      }
    ),
  }

  const paymentModule = {
    refundPayment: jest.fn(async (input: { amount: number; note: string }) => {
      order.payment_collections[0].payments[0].refunds.push({
        amount: input.amount,
        note: input.note,
      })
      order.payment_collections[0].payments[0].data = {
        cod_state: "refunded",
      }
      return {}
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
      if (key === Modules.INVENTORY) {
        return inventoryModule
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
    query,
    orderModule,
    inventoryModule,
    inventoryLedger,
    paymentModule,
    eventBus,
  }
}

describe("returns workflows", () => {
  beforeEach(() => {
    __resetMetricsForTests()
  })

  it("applies allowed transitions and blocks invalid state moves", async () => {
    const harness = makeHarness()

    await returnRequestWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "req-1",
      reason_code: "WRONG_ITEM",
    })

    const successSnapshot = getMetricsSnapshot()
    const successCounter = successSnapshot.counters.find(
      (entry) => entry.name === "workflow.return_request.success_total"
    )
    expect(successCounter).toEqual(
      expect.objectContaining({
        labels: expect.objectContaining({
          workflow: "return_request",
          result: "success",
        }),
        value: 1,
      })
    )

    await expect(
      returnReceiveWorkflow(harness.scope as any, {
        order_id: "order_01",
        idempotency_key: "recv-invalid",
      })
    ).rejects.toMatchObject({
      code: "INVALID_RETURN_STATE_TRANSITION",
    })

    await returnApproveWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "approve-1",
    })
    await returnReceiveWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "receive-1",
    })
    await returnQcFailWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "qc-fail-1",
    })
    await returnCloseWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "close-1",
    })

    expect((harness.order.metadata as Record<string, unknown>).return_state_v1).toBe(
      "closed"
    )
  })

  it("is idempotent for repeated calls with the same key", async () => {
    const harness = makeHarness()

    await returnRequestWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "req-1",
      reason_code: "DEFECTIVE",
    })

    const first = await returnApproveWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "approve-1",
    })
    const replay = await returnApproveWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "approve-1",
    })

    expect(first.changed).toBe(true)
    expect(replay.changed).toBe(false)

    const approvedEvents = harness.eventBus.emit.mock.calls
      .map((call: any[]) => call[0])
      .filter((entry: { name?: string }) => entry.name === "return.approved")

    expect(approvedEvents).toHaveLength(1)
    expect(harness.orderModule.updateOrders).toHaveBeenCalledTimes(2)
  })

  it("applies inventory movement rules and records COD refund only after qc_pass", async () => {
    const harness = makeHarness()

    await returnRequestWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "req-1",
      reason_code: "CHANGED_MIND",
    })
    await returnApproveWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "approve-1",
    })
    await returnReceiveWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "receive-1",
    })

    expect(harness.paymentModule.refundPayment).not.toHaveBeenCalled()
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

    await returnQcPassWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "qc-pass-1",
      refund_amount: 1499,
      refund_reason: "Approved return",
    })

    expect(harness.paymentModule.refundPayment).toHaveBeenCalledTimes(1)
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
    expect((harness.order.metadata as Record<string, unknown>).return_state_v1).toBe(
      "refunded"
    )
  })

  it("does not create COD refund on qc_fail path", async () => {
    const harness = makeHarness()

    await returnRequestWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "req-1",
      reason_code: "SIZE_ISSUE",
    })
    await returnApproveWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "approve-1",
    })
    await returnReceiveWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "receive-1",
    })
    await returnQcFailWorkflow(harness.scope as any, {
      order_id: "order_01",
      idempotency_key: "qc-fail-1",
    })

    expect(harness.paymentModule.refundPayment).not.toHaveBeenCalled()
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

  it("increments return_request failure metric for invalid input", async () => {
    const harness = makeHarness()

    await expect(
      returnRequestWorkflow(harness.scope as any, {
        order_id: "",
        idempotency_key: "req-failure-1",
        reason_code: "OTHER",
      })
    ).rejects.toMatchObject({
      code: "ORDER_ID_REQUIRED",
    })

    const snapshot = getMetricsSnapshot()
    const failureCounter = snapshot.counters.find(
      (entry) =>
        entry.name === "workflow.return_request.failure_total" &&
        entry.labels?.error_code === "ORDER_ID_REQUIRED"
    )

    expect(failureCounter).toEqual(
      expect.objectContaining({
        labels: expect.objectContaining({
          workflow: "return_request",
          result: "failure",
          error_code: "ORDER_ID_REQUIRED",
        }),
        value: 1,
      })
    )
  })
})
