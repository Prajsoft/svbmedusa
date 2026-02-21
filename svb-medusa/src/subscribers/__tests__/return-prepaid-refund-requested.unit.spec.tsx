import { Modules } from "@medusajs/framework/utils"
import { createReturnPrepaidRefundRequestedHandler } from "../return-prepaid-refund-requested"

const emitBusinessEventMock = jest.fn(async () => undefined)

jest.mock("../../modules/logging/business-events", () => ({
  emitBusinessEvent: (...args: unknown[]) => emitBusinessEventMock(...args),
}))

describe("return.prepaid_refund_requested subscriber", () => {
  beforeEach(() => {
    emitBusinessEventMock.mockReset()
  })

  function makeOrder() {
    return {
      id: "order_1",
      metadata: {
        return_intents_v1: {
          ret_1: {
            state: "qc_passed",
            refund: {
              status: "requested",
            },
          },
        },
      },
      payment_collections: [
        {
          payments: [
            {
              id: "pay_prepaid_1",
              provider_id: "pp_razorpay_razorpay",
              amount: 1499,
              refunds: [],
            },
          ],
        },
      ],
    }
  }

  it("refunds prepaid payment and emits processed event", async () => {
    const order = makeOrder()
    const paymentModule = {
      refundPayment: jest.fn(async () => undefined),
    }
    const orderModule = {
      updateOrders: jest.fn(async () => undefined),
    }

    const handler = createReturnPrepaidRefundRequestedHandler({
      loadOrder: jest.fn(async () => order as any),
    })

    await expect(
      handler({
        event: {
          data: {
            order_id: "order_1",
            return_id: "ret_1",
            amount: 1499,
            reason: "Customer return",
            actor_id: "admin_1",
            reference: "prepaid-refund:order_1:ret_1",
            correlation_id: "corr_1",
          },
        },
        container: {
          resolve: (key: string) => {
            if (key === Modules.PAYMENT) {
              return paymentModule
            }
            if (key === Modules.ORDER) {
              return orderModule
            }
            return {
              info: jest.fn(),
              warn: jest.fn(),
              error: jest.fn(),
            }
          },
        },
      } as any)
    ).resolves.toBeUndefined()

    expect(paymentModule.refundPayment).toHaveBeenCalledTimes(1)
    expect(paymentModule.refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_id: "pay_prepaid_1",
        amount: 1499,
      })
    )
    expect(orderModule.updateOrders).toHaveBeenCalledTimes(1)
    expect(emitBusinessEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "return.prepaid_refund_processed",
      })
    )
  })

  it("is idempotent when matching refund already exists", async () => {
    const order = makeOrder()
    ;(
      order.payment_collections?.[0]?.payments?.[0] as {
        refunds?: Array<{ amount?: number; note?: string }>
      }
    ).refunds = [{ amount: 1499, note: "Customer return [prepaid-refund:order_1:ret_1]" }]

    const paymentModule = {
      refundPayment: jest.fn(async () => undefined),
    }
    const orderModule = {
      updateOrders: jest.fn(async () => undefined),
    }

    const handler = createReturnPrepaidRefundRequestedHandler({
      loadOrder: jest.fn(async () => order as any),
    })

    await expect(
      handler({
        event: {
          data: {
            order_id: "order_1",
            return_id: "ret_1",
            amount: 1499,
            reason: "Customer return",
            reference: "prepaid-refund:order_1:ret_1",
          },
        },
        container: {
          resolve: (key: string) => {
            if (key === Modules.PAYMENT) {
              return paymentModule
            }
            if (key === Modules.ORDER) {
              return orderModule
            }
            return {
              info: jest.fn(),
              warn: jest.fn(),
              error: jest.fn(),
            }
          },
        },
      } as any)
    ).resolves.toBeUndefined()

    expect(paymentModule.refundPayment).not.toHaveBeenCalled()
    expect(orderModule.updateOrders).not.toHaveBeenCalled()
    expect(emitBusinessEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "return.prepaid_refund_processed",
        data: expect.objectContaining({
          status: "already_refunded",
        }),
      })
    )
  })
})
