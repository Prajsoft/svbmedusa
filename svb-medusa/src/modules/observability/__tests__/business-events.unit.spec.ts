import { Modules } from "@medusajs/framework/utils"
import {
  emitBusinessEvent,
  getAuditTimelineForOrder,
  getAuditTimelineForReturn,
} from "../business-events"

function makeScope(params?: {
  createdEvent?: Record<string, unknown>
  listedEvents?: Array<Record<string, unknown>>
}) {
  const observabilityService = {
    createBusinessEvents: jest.fn(async (input: Record<string, unknown>) => {
      if (params?.createdEvent) {
        return { ...params.createdEvent, ...input }
      }

      return {
        id: "bev_01",
        ...input,
      }
    }),
    listBusinessEvents: jest.fn(async () => params?.listedEvents ?? []),
  }

  const eventBus = {
    emit: jest.fn(async () => undefined),
  }

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }

  const scope = {
    resolve: (key: string) => {
      if (key === "observability") {
        return observabilityService
      }

      if (key === Modules.EVENT_BUS) {
        return eventBus
      }

      if (key === "logger") {
        return logger
      }

      throw new Error(`Unknown container key: ${key}`)
    },
  }

  return { scope, observabilityService, eventBus, logger }
}

describe("observability business events", () => {
  it("stores emitted event with correlation_id", async () => {
    const harness = makeScope()

    const result = await emitBusinessEvent(
      "promotion.applied",
      {
        cart_id: "cart_01",
        code: "SVB10",
      },
      {
        scope: harness.scope as any,
        correlation_id: "corr-123",
        actor: {
          type: "customer",
          id: "cus_01",
        },
        entity_refs: [{ type: "cart", id: "cart_01" }],
        workflow_name: "cart_apply_coupon",
        step_name: "emit_event",
      }
    )

    expect(harness.observabilityService.createBusinessEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "promotion.applied",
        correlation_id: "corr-123",
        schema_version: "v1",
        entity_refs: expect.arrayContaining([
          expect.objectContaining({ type: "cart", id: "cart_01" }),
        ]),
      })
    )

    expect(harness.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "promotion.applied",
        data: expect.objectContaining({
          cart_id: "cart_01",
          correlation_id: "corr-123",
        }),
      })
    )

    expect(result.correlation_id).toBe("corr-123")
  })

  it("returns order timeline sorted by created_at", async () => {
    const harness = makeScope({
      listedEvents: [
        {
          id: "bev_2",
          name: "fulfillment.requested",
          payload: { order_id: "order_01" },
          correlation_id: "corr-b",
          created_at: "2026-02-18T10:05:00.000Z",
          entity_refs: [{ type: "order", id: "order_01" }],
          actor: { type: "system" },
          schema_version: "v1",
        },
        {
          id: "bev_1",
          name: "order.placed",
          payload: { order_id: "order_01" },
          correlation_id: "corr-a",
          created_at: "2026-02-18T10:00:00.000Z",
          entity_refs: [{ type: "order", id: "order_01" }],
          actor: { type: "system" },
          schema_version: "v1",
        },
        {
          id: "bev_3",
          name: "order.placed",
          payload: { order_id: "order_99" },
          correlation_id: "corr-z",
          created_at: "2026-02-18T10:01:00.000Z",
          entity_refs: [{ type: "order", id: "order_99" }],
          actor: { type: "system" },
          schema_version: "v1",
        },
      ],
    })

    const timeline = await getAuditTimelineForOrder("order_01", {
      scope: harness.scope as any,
    })

    expect(timeline.map((event) => event.id)).toEqual(["bev_1", "bev_2"])
    expect(harness.observabilityService.listBusinessEvents).toHaveBeenCalledTimes(
      1
    )
  })

  it("returns return timeline sorted by created_at", async () => {
    const harness = makeScope({
      listedEvents: [
        {
          id: "bev_12",
          name: "return.received",
          payload: { return_id: "ret_01" },
          correlation_id: "corr-2",
          created_at: "2026-02-18T12:05:00.000Z",
          entity_refs: [{ type: "return", id: "ret_01" }],
          actor: { type: "admin", id: "admin_1" },
          schema_version: "v1",
        },
        {
          id: "bev_11",
          name: "return.requested",
          payload: { return_id: "ret_01" },
          correlation_id: "corr-1",
          created_at: "2026-02-18T12:00:00.000Z",
          entity_refs: [{ type: "return", id: "ret_01" }],
          actor: { type: "customer", id: "cus_1" },
          schema_version: "v1",
        },
      ],
    })

    const timeline = await getAuditTimelineForReturn("ret_01", {
      scope: harness.scope as any,
    })

    expect(timeline.map((event) => event.id)).toEqual(["bev_11", "bev_12"])
  })
})
