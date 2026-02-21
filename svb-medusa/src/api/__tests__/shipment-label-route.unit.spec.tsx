import { GET } from "../shipments/[id]/label/route"
import { ShipmentLabelError } from "../../modules/shipping/shipment-label"
import { ShippingProviderError } from "../../integrations/carriers/provider-contract"

const resolveShipmentLabelMock = jest.fn()

jest.mock("../../modules/shipping/shipment-label", () => {
  const actual = jest.requireActual("../../modules/shipping/shipment-label")
  return {
    ...actual,
    resolveShipmentLabel: (...args: unknown[]) => resolveShipmentLabelMock(...args),
  }
})

function makeReq(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    params: { id: "ship_1" },
    scope: {
      resolve: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      })),
    },
    auth_context: { actor_id: "admin_1", actor_type: "user" },
    correlation_id: "corr_label_route",
    ...overrides,
  } as any
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as unknown,
    status: jest.fn(function (code: number) {
      res.statusCode = code
      return res
    }),
    json: jest.fn(function (payload: unknown) {
      res.body = payload
      return res
    }),
  }
  return res
}

describe("GET /shipments/:id/label", () => {
  beforeEach(() => {
    resolveShipmentLabelMock.mockReset()
  })

  it("returns UNAUTHORIZED when actor is missing", async () => {
    const req = makeReq({
      auth_context: {},
    })
    const res = makeRes()

    await GET(req, res)

    expect(resolveShipmentLabelMock).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "UNAUTHORIZED",
        error: expect.objectContaining({
          code: "UNAUTHORIZED",
        }),
      })
    )
  })

  it("returns label payload when resolver succeeds", async () => {
    resolveShipmentLabelMock.mockResolvedValue({
      shipment_id: "ship_1",
      provider: "shiprocket",
      provider_shipment_id: "sr_1",
      label_url: "https://labels.example/ship_1.pdf",
      label_expires_at: "2026-02-22T12:00:00.000Z",
      label_status: "AVAILABLE",
      refreshed: false,
    })

    const req = makeReq()
    const res = makeRes()
    await GET(req, res)

    expect(resolveShipmentLabelMock).toHaveBeenCalledWith(
      req.scope,
      expect.objectContaining({
        shipment_id: "ship_1",
        correlation_id: "corr_label_route",
      })
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        shipment_id: "ship_1",
        label_url: "https://labels.example/ship_1.pdf",
        correlation_id: "corr_label_route",
      })
    )
  })

  it("maps ShipmentLabelError to its HTTP status", async () => {
    resolveShipmentLabelMock.mockRejectedValue(
      new ShipmentLabelError("SHIPMENT_NOT_FOUND", "Shipment ship_1 was not found.", 404)
    )

    const req = makeReq()
    const res = makeRes()
    await GET(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "SHIPMENT_NOT_FOUND",
      })
    )
  })

  it("maps ShippingProviderError to 503 for provider unavailable", async () => {
    resolveShipmentLabelMock.mockRejectedValue(
      new ShippingProviderError({
        code: "PROVIDER_UNAVAILABLE",
        message: "Provider circuit breaker is open.",
        details: {},
        correlation_id: "corr_provider_unavailable",
      })
    )

    const req = makeReq()
    const res = makeRes()
    await GET(req, res)

    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "PROVIDER_UNAVAILABLE",
      })
    )
  })
})

