import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GET as getAttentionOrders } from "../ops/attention/orders/route"
import { GET as getAttentionFulfillments } from "../ops/attention/fulfillments/route"
import { GET as getAttentionCod } from "../ops/attention/cod/route"
import { GET as getAttentionReturns } from "../ops/attention/returns/route"
import { GET as getOrderTimeline } from "../ops/order/[id]/timeline/route"

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

function makeHarness() {
  const orders = [
    {
      id: "order_pending",
      metadata: {
        fulfillment_state_v1: "pending",
        fulfillment_last_error_v1: {
          code: "FULFILLMENT_REQUEST_FAILED",
          at: "2026-02-18T10:00:00.000Z",
        },
        fulfillment_intents_v1: {
          "order_pending:1": {
            state: "requested",
            requested_at: "2020-01-01T00:00:00.000Z",
          },
        },
      },
      payment_collections: [],
    },
    {
      id: "order_cod",
      metadata: {
        fulfillment_state_v1: "delivered",
        fulfillment_intents_v1: {
          "order_cod:1": {
            state: "delivered",
            last_transition_at: "2020-01-01T00:00:00.000Z",
            status_history: [
              {
                to_status: "delivered",
                at: "2020-01-01T00:00:00.000Z",
              },
            ],
          },
        },
      },
      payment_collections: [
        {
          payments: [
            {
              id: "pay_cod_1",
              provider_id: "pp_cod_cod",
              captured_at: null,
              data: { cod_state: "authorized" },
            },
          ],
        },
      ],
    },
    {
      id: "order_return",
      metadata: {
        return_intents_v1: {
          return_01: {
            return_id: "return_01",
            state: "received",
            updated_at: "2020-01-01T00:00:00.000Z",
          },
        },
      },
      payment_collections: [],
    },
    {
      id: "order_healthy",
      metadata: {
        fulfillment_state_v1: "ready_for_shipment",
      },
      payment_collections: [],
    },
  ]

  const events = [
    {
      id: "e1",
      name: "order.placed",
      created_at: "2026-02-18T10:00:00.000Z",
      correlation_id: "corr-1",
      payload: { order_id: "order_pending" },
      entity_refs: [{ type: "order", id: "order_pending" }],
      actor: { type: "system" },
      schema_version: "v1",
    },
    {
      id: "e2",
      name: "fulfillment.request_failed",
      created_at: "2026-02-18T11:00:00.000Z",
      correlation_id: "corr-2",
      payload: { order_id: "order_pending" },
      entity_refs: [{ type: "order", id: "order_pending" }],
      actor: { type: "system" },
      schema_version: "v1",
    },
    {
      id: "e3",
      name: "order.placed",
      created_at: "2026-02-18T09:00:00.000Z",
      correlation_id: "corr-3",
      payload: { order_id: "order_cod" },
      entity_refs: [{ type: "order", id: "order_cod" }],
      actor: { type: "system" },
      schema_version: "v1",
    },
    {
      id: "e4",
      name: "payment.authorized",
      created_at: "2026-02-18T09:05:00.000Z",
      correlation_id: "corr-4",
      payload: { order_id: "order_cod" },
      entity_refs: [{ type: "order", id: "order_cod" }],
      actor: { type: "system" },
      schema_version: "v1",
    },
    {
      id: "e5",
      name: "return.requested",
      created_at: "2026-02-17T09:00:00.000Z",
      correlation_id: "corr-5",
      payload: { order_id: "order_return", return_id: "return_01" },
      entity_refs: [
        { type: "order", id: "order_return" },
        { type: "return", id: "return_01" },
      ],
      actor: { type: "customer" },
      schema_version: "v1",
    },
    {
      id: "e6",
      name: "return.received",
      created_at: "2026-02-17T10:00:00.000Z",
      correlation_id: "corr-6",
      payload: { order_id: "order_return", return_id: "return_01" },
      entity_refs: [
        { type: "order", id: "order_return" },
        { type: "return", id: "return_01" },
      ],
      actor: { type: "admin", id: "admin_1" },
      schema_version: "v1",
    },
  ]

  const query = {
    graph: jest.fn(async () => ({ data: orders })),
  }

  const observabilityService = {
    listBusinessEvents: jest.fn(async () => events),
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
      if (key === "observability") {
        return observabilityService
      }
      if (key === "logger") {
        return logger
      }

      throw new Error(`Unknown container key: ${key}`)
    },
  }

  return {
    scope,
    query,
    observabilityService,
  }
}

describe("admin ops dashboard routes", () => {
  const previous = {
    fulfillment: process.env.OPS_STUCK_FULFILLMENT_THRESHOLD_MINUTES,
    cod: process.env.OPS_COD_CAPTURE_PENDING_THRESHOLD_DAYS,
    returns: process.env.OPS_RETURNS_QC_STUCK_THRESHOLD_DAYS,
  }

  beforeEach(() => {
    process.env.OPS_STUCK_FULFILLMENT_THRESHOLD_MINUTES = "30"
    process.env.OPS_COD_CAPTURE_PENDING_THRESHOLD_DAYS = "3"
    process.env.OPS_RETURNS_QC_STUCK_THRESHOLD_DAYS = "2"
  })

  afterAll(() => {
    process.env.OPS_STUCK_FULFILLMENT_THRESHOLD_MINUTES = previous.fulfillment
    process.env.OPS_COD_CAPTURE_PENDING_THRESHOLD_DAYS = previous.cod
    process.env.OPS_RETURNS_QC_STUCK_THRESHOLD_DAYS = previous.returns
  })

  it("GET /ops/attention/orders returns deterministic order attention items", async () => {
    const harness = makeHarness()
    const req: any = { scope: harness.scope, params: {}, query: {} }
    const res = makeRes()

    await getAttentionOrders(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      items: [
        expect.objectContaining({
          entity_id: "order_pending",
          current_state: "pending",
          last_event_name: "fulfillment.request_failed",
          last_error_code: "FULFILLMENT_REQUEST_FAILED",
        }),
      ],
      count: 1,
    })
  })

  it("GET /ops/attention/fulfillments returns deterministic fulfillment attention items", async () => {
    const harness = makeHarness()
    const req: any = { scope: harness.scope, params: {}, query: {} }
    const res = makeRes()

    await getAttentionFulfillments(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      items: [
        expect.objectContaining({
          entity_id: "order_pending:order_pending:1",
          current_state: "requested",
          last_event_name: "fulfillment.request_failed",
          last_error_code: "FULFILLMENT_REQUEST_FAILED",
        }),
      ],
      count: 1,
    })
  })

  it("GET /ops/attention/cod returns deterministic COD attention items", async () => {
    const harness = makeHarness()
    const req: any = { scope: harness.scope, params: {}, query: {} }
    const res = makeRes()

    await getAttentionCod(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      items: [
        expect.objectContaining({
          entity_id: "order_cod",
          current_state: "capture_pending",
          last_event_name: "payment.authorized",
          last_error_code: null,
        }),
      ],
      count: 1,
    })
  })

  it("GET /ops/attention/returns returns deterministic return attention items", async () => {
    const harness = makeHarness()
    const req: any = { scope: harness.scope, params: {}, query: {} }
    const res = makeRes()

    await getAttentionReturns(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      items: [
        expect.objectContaining({
          entity_id: "return_01",
          current_state: "received",
          last_event_name: "return.received",
          last_error_code: null,
        }),
      ],
      count: 1,
    })
  })

  it("GET /ops/order/:id/timeline returns audit timeline", async () => {
    const harness = makeHarness()
    const req: any = {
      scope: harness.scope,
      params: { id: "order_return" },
      query: {},
    }
    const res = makeRes()

    await getOrderTimeline(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      order_id: "order_return",
      timeline: [
        expect.objectContaining({
          id: "e5",
          name: "return.requested",
        }),
        expect.objectContaining({
          id: "e6",
          name: "return.received",
        }),
      ],
      count: 2,
    })
  })
})
