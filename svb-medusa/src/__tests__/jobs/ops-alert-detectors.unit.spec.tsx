import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  runCodCapturePendingDetector,
  runReturnsQcStuckDetector,
  runStuckFulfillmentDetector,
} from "../../modules/ops-alert-detectors"

function makeHarness(orders: Array<Record<string, unknown>>) {
  const query = {
    graph: jest.fn(async () => ({ data: orders })),
  }

  const eventBus = {
    emit: jest.fn(async () => undefined),
  }

  const scope = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) {
        return query
      }
      if (key === Modules.EVENT_BUS) {
        return eventBus
      }
      throw new Error(`Unknown key: ${key}`)
    },
  }

  return { scope, query, eventBus }
}

describe("ops alert detectors", () => {
  const now = new Date("2026-02-19T10:00:00.000Z")

  const originalEnv = {
    stuck: process.env.OPS_STUCK_FULFILLMENT_THRESHOLD_MINUTES,
    cod: process.env.OPS_COD_CAPTURE_PENDING_THRESHOLD_DAYS,
    returns: process.env.OPS_RETURNS_QC_STUCK_THRESHOLD_DAYS,
  }

  afterEach(() => {
    process.env.OPS_STUCK_FULFILLMENT_THRESHOLD_MINUTES = originalEnv.stuck
    process.env.OPS_COD_CAPTURE_PENDING_THRESHOLD_DAYS = originalEnv.cod
    process.env.OPS_RETURNS_QC_STUCK_THRESHOLD_DAYS = originalEnv.returns
  })

  it("raises alert for stuck fulfillment intent", async () => {
    const harness = makeHarness([
      {
        id: "order_01",
        metadata: {
          fulfillment_intents_v1: {
            "order_01:1": {
              state: "requested",
              requested_at: "2026-02-19T09:00:00.000Z",
            },
          },
        },
      },
    ])

    const result = await runStuckFulfillmentDetector(harness.scope as any, {
      now,
      stuckFulfillmentMinutes: 30,
    })

    expect(result).toEqual({
      scanned_orders: 1,
      alerts_raised: 1,
    })
    expect(harness.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ops.alert.raised",
        data: expect.objectContaining({
          type: "stuck_fulfillment",
          severity: "high",
          entity_id: "order_01:order_01:1",
        }),
      })
    )
  })

  it("does not raise stuck fulfillment alert for healthy intent", async () => {
    const harness = makeHarness([
      {
        id: "order_healthy",
        metadata: {
          fulfillment_intents_v1: {
            "order_healthy:1": {
              state: "ready_for_shipment",
              requested_at: "2026-02-19T09:55:00.000Z",
            },
          },
        },
      },
    ])

    const result = await runStuckFulfillmentDetector(harness.scope as any, {
      now,
      stuckFulfillmentMinutes: 30,
    })

    expect(result.alerts_raised).toBe(0)
    expect(harness.eventBus.emit).not.toHaveBeenCalled()
  })

  it("raises alert for delivered COD order pending capture", async () => {
    const harness = makeHarness([
      {
        id: "order_cod_01",
        metadata: {
          fulfillment_intents_v1: {
            "order_cod_01:1": {
              state: "delivered",
              last_transition_at: "2026-02-10T10:00:00.000Z",
            },
          },
        },
        payment_collections: [
          {
            payments: [
              {
                id: "pay_01",
                provider_id: "pp_cod_cod",
                captured_at: null,
                data: { cod_state: "authorized" },
              },
            ],
          },
        ],
      },
    ])

    const result = await runCodCapturePendingDetector(harness.scope as any, {
      now,
      codCapturePendingDays: 3,
    })

    expect(result.alerts_raised).toBe(1)
    expect(harness.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ops.alert.raised",
        data: expect.objectContaining({
          type: "cod_capture_pending",
          severity: "high",
          entity_id: "order_cod_01",
        }),
      })
    )
  })

  it("does not raise COD pending alert when COD is already captured", async () => {
    const harness = makeHarness([
      {
        id: "order_cod_ok",
        metadata: {
          fulfillment_intents_v1: {
            "order_cod_ok:1": {
              state: "delivered",
              last_transition_at: "2026-02-10T10:00:00.000Z",
            },
          },
        },
        payment_collections: [
          {
            payments: [
              {
                id: "pay_02",
                provider_id: "pp_cod_cod",
                captured_at: "2026-02-11T10:00:00.000Z",
                data: { cod_state: "captured" },
              },
            ],
          },
        ],
      },
    ])

    const result = await runCodCapturePendingDetector(harness.scope as any, {
      now,
      codCapturePendingDays: 3,
    })

    expect(result.alerts_raised).toBe(0)
    expect(harness.eventBus.emit).not.toHaveBeenCalled()
  })

  it("raises alert for return received with no QC outcome", async () => {
    const harness = makeHarness([
      {
        id: "order_ret_01",
        metadata: {
          return_intents_v1: {
            return_01: {
              return_id: "return_01",
              state: "received",
              updated_at: "2026-02-10T10:00:00.000Z",
            },
          },
        },
      },
    ])

    const result = await runReturnsQcStuckDetector(harness.scope as any, {
      now,
      returnsQcStuckDays: 2,
    })

    expect(result.alerts_raised).toBe(1)
    expect(harness.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ops.alert.raised",
        data: expect.objectContaining({
          type: "returns_qc_stuck",
          severity: "medium",
          entity_id: "return_01",
        }),
      })
    )
  })

  it("does not raise return QC alert for healthy return", async () => {
    const harness = makeHarness([
      {
        id: "order_ret_ok",
        metadata: {
          return_intents_v1: {
            return_02: {
              return_id: "return_02",
              state: "qc_passed",
              updated_at: "2026-02-18T10:00:00.000Z",
            },
          },
        },
      },
    ])

    const result = await runReturnsQcStuckDetector(harness.scope as any, {
      now,
      returnsQcStuckDays: 2,
    })

    expect(result.alerts_raised).toBe(0)
    expect(harness.eventBus.emit).not.toHaveBeenCalled()
  })

  it("reads threshold from environment when options are not passed", async () => {
    process.env.OPS_STUCK_FULFILLMENT_THRESHOLD_MINUTES = "5"
    const harness = makeHarness([
      {
        id: "order_env_01",
        metadata: {
          fulfillment_intents_v1: {
            "order_env_01:1": {
              state: "requested",
              requested_at: "2026-02-19T09:54:00.000Z",
            },
          },
        },
      },
    ])

    const result = await runStuckFulfillmentDetector(harness.scope as any, {
      now,
    })

    expect(result.alerts_raised).toBe(1)
  })
})
