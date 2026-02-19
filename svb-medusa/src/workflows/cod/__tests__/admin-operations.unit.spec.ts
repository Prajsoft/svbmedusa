import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  captureCodPaymentWorkflow,
  CodAdminOperationError,
  recordCodRefundWorkflow,
} from "../admin-operations"

function makeOrder() {
  return {
    id: "order_01",
    payment_collections: [
      {
        id: "paycol_01",
        payments: [
          {
            id: "pay_cod_01",
            provider_id: "pp_cod_cod",
            amount: 1500,
            currency_code: "INR",
            captured_at: null as string | null,
            data: { cod_state: "authorized" },
            refunds: [] as Array<{ amount: number; note: string }>,
          },
        ],
      },
    ],
  }
}

describe("COD admin operations", () => {
  it("capture twice does not double-change state", async () => {
    const order = makeOrder()
    const payment = order.payment_collections[0].payments[0]

    const query = {
      graph: jest.fn(async () => ({ data: [order] })),
    }

    const paymentModule = {
      capturePayment: jest.fn(async () => {
        payment.captured_at = "2026-02-18T12:00:00.000Z"
        payment.data = { ...(payment.data ?? {}), cod_state: "captured" }
        return payment
      }),
      refundPayment: jest.fn(),
    }

    const eventBus = {
      emit: jest.fn(async () => undefined),
    }

    const scope = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) {
          return query
        }

        if (key === Modules.PAYMENT) {
          return paymentModule
        }

        if (key === Modules.EVENT_BUS) {
          return eventBus
        }

        throw new Error(`Unknown container key: ${key}`)
      },
    }

    const first = await captureCodPaymentWorkflow(scope as any, {
      order_id: "order_01",
      actor_id: "admin_01",
    })
    const second = await captureCodPaymentWorkflow(scope as any, {
      order_id: "order_01",
      actor_id: "admin_01",
    })

    expect(first.already_captured).toBe(false)
    expect(second.already_captured).toBe(true)
    expect(paymentModule.capturePayment).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "cod.captured",
        data: expect.objectContaining({
          order_id: "order_01",
          payment_id: "pay_cod_01",
        }),
      })
    )
  })

  it("refund record twice does not create duplicates", async () => {
    const order = makeOrder()
    const payment = order.payment_collections[0].payments[0]
    payment.captured_at = "2026-02-18T12:00:00.000Z"
    payment.data = { cod_state: "captured" }

    const query = {
      graph: jest.fn(async () => ({ data: [order] })),
    }

    const paymentModule = {
      capturePayment: jest.fn(),
      refundPayment: jest.fn(async (input: { amount: number; note: string }) => {
        ;(payment.refunds as Array<{ amount: number; note: string }>).push({
          amount: input.amount,
          note: input.note,
        })
        payment.data = { ...(payment.data ?? {}), cod_state: "refunded" }
        return payment
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

        if (key === Modules.PAYMENT) {
          return paymentModule
        }

        if (key === Modules.EVENT_BUS) {
          return eventBus
        }

        throw new Error(`Unknown container key: ${key}`)
      },
    }

    const first = await recordCodRefundWorkflow(scope as any, {
      order_id: "order_01",
      amount: 500,
      reason: "Customer return",
      actor_id: "admin_01",
    })
    const second = await recordCodRefundWorkflow(scope as any, {
      order_id: "order_01",
      amount: 500,
      reason: "Customer return",
      actor_id: "admin_01",
    })

    expect(first.already_recorded).toBe(false)
    expect(second.already_recorded).toBe(true)
    expect(paymentModule.refundPayment).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "cod.refund_recorded",
        data: expect.objectContaining({
          order_id: "order_01",
          payment_id: "pay_cod_01",
          amount: 500,
          reason: "Customer return",
        }),
      })
    )
  })

  it("invalid refund amount is rejected", async () => {
    await expect(
      recordCodRefundWorkflow({} as any, {
        order_id: "order_01",
        amount: 0,
        reason: "Invalid",
      })
    ).rejects.toMatchObject({
      code: "INVALID_REFUND_AMOUNT",
    } satisfies Pick<CodAdminOperationError, "code">)
  })
})
