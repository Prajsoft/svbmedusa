import { ShippingProviderError } from "../../../integrations/carriers/provider-contract"
import { ShipmentLabelStatus } from "../shipment-persistence"
import { ShipmentLabelError, resolveShipmentLabel } from "../shipment-label"

const createShippingProviderRouterMock = jest.fn()
const getShippingPersistenceRepositoryMock = jest.fn()

jest.mock("../provider-router", () => ({
  createShippingProviderRouter: (...args: unknown[]) =>
    createShippingProviderRouterMock(...args),
  getShippingPersistenceRepository: (...args: unknown[]) =>
    getShippingPersistenceRepositoryMock(...args),
}))

function makeScope() {
  return {
    resolve: jest.fn((key: string) => {
      if (key === "logger") {
        return {
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        }
      }
      return undefined
    }),
  } as any
}

describe("resolveShipmentLabel", () => {
  beforeEach(() => {
    createShippingProviderRouterMock.mockReset()
    getShippingPersistenceRepositoryMock.mockReset()
  })

  it("returns cached label when available and not expired", async () => {
    const repository = {
      getShipmentById: jest.fn(async () => ({
        id: "ship_1",
        provider: "shiprocket",
        provider_shipment_id: "sr_123",
        provider_awb: "AWB123",
        provider_order_id: "order_ref_1",
        status: "BOOKED",
        label_url: "https://labels.example/existing.pdf",
        label_generated_at: new Date("2026-02-18T12:00:00.000Z"),
        label_expires_at: new Date("2026-02-22T12:00:00.000Z"),
        label_status: ShipmentLabelStatus.AVAILABLE,
      })),
      markShipmentBookedFromProvider: jest.fn(async (input) => ({
        id: "ship_1",
        provider: "shiprocket",
        provider_shipment_id: "sr_123",
        label_url: input.label_url,
        label_expires_at: input.label_expires_at,
        label_status: input.label_status,
      })),
    }
    getShippingPersistenceRepositoryMock.mockReturnValue(repository)

    const result = await resolveShipmentLabel(
      makeScope(),
      { shipment_id: "ship_1", correlation_id: "corr_label_cached" },
      { repository: repository as any }
    )

    expect(createShippingProviderRouterMock).not.toHaveBeenCalled()
    expect(repository.markShipmentBookedFromProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        shipment_id: "ship_1",
        label_status: ShipmentLabelStatus.AVAILABLE,
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        shipment_id: "ship_1",
        label_url: "https://labels.example/existing.pdf",
        refreshed: false,
      })
    )
  })

  it("refreshes label when expired", async () => {
    const repository = {
      getShipmentById: jest.fn(async () => ({
        id: "ship_2",
        provider: "shiprocket",
        provider_shipment_id: "sr_456",
        provider_awb: "AWB456",
        provider_order_id: "order_ref_2",
        status: "BOOKED",
        label_url: "https://labels.example/expired.pdf",
        label_generated_at: new Date("2026-02-17T12:00:00.000Z"),
        label_expires_at: new Date("2026-02-18T12:00:00.000Z"),
        label_status: ShipmentLabelStatus.EXPIRED,
      })),
      markShipmentBookedFromProvider: jest.fn(async (input) => ({
        id: "ship_2",
        provider: "shiprocket",
        provider_shipment_id: "sr_456",
        label_url: input.label_url,
        label_expires_at: input.label_expires_at,
        label_status: input.label_status,
      })),
    }
    getShippingPersistenceRepositoryMock.mockReturnValue(repository)
    createShippingProviderRouterMock.mockReturnValue({
      router: {
        getLabel: jest.fn(async () => ({
          shipment_id: "sr_456",
          label_url: "https://labels.example/fresh.pdf",
          mime_type: "application/pdf",
          label_expires_at: "2026-02-25T12:00:00.000Z",
          regenerated: true,
        })),
      },
    })

    const result = await resolveShipmentLabel(
      makeScope(),
      { shipment_id: "ship_2", correlation_id: "corr_label_refresh" },
      { repository: repository as any, now: () => new Date("2026-02-19T12:00:00.000Z") }
    )

    expect(createShippingProviderRouterMock).toHaveBeenCalled()
    expect(repository.markShipmentBookedFromProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        shipment_id: "ship_2",
        label_url: "https://labels.example/fresh.pdf",
        label_status: ShipmentLabelStatus.AVAILABLE,
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        shipment_id: "ship_2",
        label_url: "https://labels.example/fresh.pdf",
        refreshed: true,
      })
    )
  })

  it("throws SHIPMENT_NOT_FOUND when shipment is missing", async () => {
    const repository = {
      getShipmentById: jest.fn(async () => null),
    }
    getShippingPersistenceRepositoryMock.mockReturnValue(repository)

    await expect(
      resolveShipmentLabel(
        makeScope(),
        { shipment_id: "missing", correlation_id: "corr_missing" },
        { repository: repository as any }
      )
    ).rejects.toMatchObject<Partial<ShipmentLabelError>>({
      code: "SHIPMENT_NOT_FOUND",
      httpStatus: 404,
    })
  })

  it("marks label as EXPIRED when provider refresh fails", async () => {
    const repository = {
      getShipmentById: jest.fn(async () => ({
        id: "ship_3",
        provider: "shiprocket",
        provider_shipment_id: "sr_789",
        provider_awb: "AWB789",
        provider_order_id: "order_ref_3",
        status: "BOOKED",
        label_url: "https://labels.example/old.pdf",
        label_generated_at: new Date("2026-02-15T12:00:00.000Z"),
        label_expires_at: new Date("2026-02-16T12:00:00.000Z"),
        label_status: ShipmentLabelStatus.EXPIRED,
      })),
      markShipmentBookedFromProvider: jest.fn(async () => null),
    }
    getShippingPersistenceRepositoryMock.mockReturnValue(repository)
    createShippingProviderRouterMock.mockReturnValue({
      router: {
        getLabel: jest.fn(async () => {
          throw new ShippingProviderError({
            code: "RATE_LIMITED",
            message: "rate limited",
            correlation_id: "corr_failure",
            details: {},
          })
        }),
      },
    })

    await expect(
      resolveShipmentLabel(
        makeScope(),
        { shipment_id: "ship_3", correlation_id: "corr_failure" },
        { repository: repository as any, now: () => new Date("2026-02-19T12:00:00.000Z") }
      )
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
    })

    expect(repository.markShipmentBookedFromProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        shipment_id: "ship_3",
        label_status: ShipmentLabelStatus.EXPIRED,
      })
    )
  })
})

