jest.mock("../../../workflows/ops/actions", () => ({
  retryFulfillmentActionWorkflow: jest.fn(),
  rebuildShipmentContractActionWorkflow: jest.fn(),
  markCodCapturedActionWorkflow: jest.fn(),
  recordCodRefundActionWorkflow: jest.fn(),
}))

import {
  markCodCapturedActionWorkflow,
  rebuildShipmentContractActionWorkflow,
  recordCodRefundActionWorkflow,
  retryFulfillmentActionWorkflow,
} from "../../../workflows/ops/actions"
import { POST as postRetryFulfillment } from "../ops/actions/retry-fulfillment/route"
import { POST as postRebuildShipmentContract } from "../ops/actions/rebuild-shipment-contract/route"
import { POST as postMarkCodCaptured } from "../ops/actions/mark-cod-captured/route"
import { POST as postRecordCodRefund } from "../ops/actions/record-cod-refund/route"

function makeRes() {
  const res: any = {
    statusCode: 200,
    json: jest.fn(function (_payload: any) {
      return res
    }),
    status: jest.fn(function (code: number) {
      res.statusCode = code
      return res
    }),
  }

  return res
}

describe("admin ops action routes", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("retry-fulfillment route triggers workflow", async () => {
    ;(retryFulfillmentActionWorkflow as jest.Mock).mockResolvedValue({
      order_id: "order_01",
      status: "applied",
      fulfillment_attempt: 2,
    })

    const req: any = {
      scope: {},
      body: { order_id: "order_01" },
      auth_context: { actor_id: "admin_01" },
      correlation_id: "corr-ops-1",
    }
    const res = makeRes()

    await postRetryFulfillment(req, res)

    expect(retryFulfillmentActionWorkflow).toHaveBeenCalledWith(
      req.scope,
      expect.objectContaining({
        order_id: "order_01",
        actor_id: "admin_01",
        correlation_id: "corr-ops-1",
      })
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "applied",
      })
    )
  })

  it("rebuild-shipment-contract route triggers workflow", async () => {
    ;(rebuildShipmentContractActionWorkflow as jest.Mock).mockResolvedValue({
      order_id: "order_01",
      status: "applied",
      fulfillment_attempt: 1,
    })

    const req: any = {
      scope: {},
      body: { order_id: "order_01" },
      auth_context: { actor_id: "admin_01" },
      correlation_id: "corr-ops-2",
    }
    const res = makeRes()

    await postRebuildShipmentContract(req, res)

    expect(rebuildShipmentContractActionWorkflow).toHaveBeenCalledWith(
      req.scope,
      expect.objectContaining({
        order_id: "order_01",
        actor_id: "admin_01",
        correlation_id: "corr-ops-2",
      })
    )
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it("mark-cod-captured route triggers workflow and repeated call can be noop", async () => {
    ;(markCodCapturedActionWorkflow as jest.Mock)
      .mockResolvedValueOnce({
        order_id: "order_01",
        status: "applied",
        payment_id: "pay_cod_01",
      })
      .mockResolvedValueOnce({
        order_id: "order_01",
        status: "noop",
        payment_id: "pay_cod_01",
      })

    const req: any = {
      scope: {},
      body: { order_id: "order_01" },
      auth_context: { actor_id: "admin_01" },
      correlation_id: "corr-ops-3",
    }
    const firstRes = makeRes()
    const secondRes = makeRes()

    await postMarkCodCaptured(req, firstRes)
    await postMarkCodCaptured(req, secondRes)

    expect(markCodCapturedActionWorkflow).toHaveBeenCalledTimes(2)
    expect(firstRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "applied" })
    )
    expect(secondRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "noop" })
    )
  })

  it("record-cod-refund route triggers workflow and repeated call can be noop", async () => {
    ;(recordCodRefundActionWorkflow as jest.Mock)
      .mockResolvedValueOnce({
        order_id: "order_01",
        status: "applied",
        payment_id: "pay_cod_01",
      })
      .mockResolvedValueOnce({
        order_id: "order_01",
        status: "noop",
        payment_id: "pay_cod_01",
      })

    const req: any = {
      scope: {},
      body: { order_id: "order_01", amount: 1499, reason: "Approved refund" },
      auth_context: { actor_id: "admin_01" },
      correlation_id: "corr-ops-4",
    }
    const firstRes = makeRes()
    const secondRes = makeRes()

    await postRecordCodRefund(req, firstRes)
    await postRecordCodRefund(req, secondRes)

    expect(recordCodRefundActionWorkflow).toHaveBeenCalledTimes(2)
    expect(recordCodRefundActionWorkflow).toHaveBeenNthCalledWith(
      1,
      req.scope,
      expect.objectContaining({
        order_id: "order_01",
        amount: 1499,
        reason: "Approved refund",
        actor_id: "admin_01",
      })
    )
    expect(firstRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "applied" })
    )
    expect(secondRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "noop" })
    )
  })

  it("returns 401 when actor is missing", async () => {
    const req: any = {
      scope: {},
      body: { order_id: "order_01" },
    }
    const res = makeRes()

    await postRetryFulfillment(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "UNAUTHORIZED",
      })
    )
  })
})
