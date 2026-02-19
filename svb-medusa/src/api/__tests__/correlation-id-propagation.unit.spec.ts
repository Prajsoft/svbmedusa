import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { correlationIdMiddleware } from "../middlewares"
import { emitBusinessEvent } from "../../modules/logging/business-events"

function makeScope(eventBus: { emit: jest.Mock }) {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }

  return {
    logger,
    scope: {
      resolve: (key: string) => {
        if (key === Modules.EVENT_BUS) {
          return eventBus
        }

        if (key === ContainerRegistrationKeys.LOGGER || key === "logger") {
          return logger
        }

        throw new Error(`Unknown container key: ${key}`)
      },
    },
  }
}

describe("correlation id middleware and propagation", () => {
  it("reuses incoming x-correlation-id header", () => {
    const eventBus = { emit: jest.fn(async () => undefined) }
    const { scope } = makeScope(eventBus)

    const req = {
      headers: {
        "x-correlation-id": "corr-checkout-123",
      },
      method: "POST",
      originalUrl: "/store/carts/cart_01/complete",
      params: { id: "cart_01" },
      scope,
    } as any

    const res = {
      setHeader: jest.fn(),
    } as any

    const next = jest.fn()
    correlationIdMiddleware(req, res, next)

    expect(req.correlation_id).toBe("corr-checkout-123")
    expect(res.setHeader).toHaveBeenCalledWith(
      "x-correlation-id",
      "corr-checkout-123"
    )
    expect(next).toHaveBeenCalledTimes(1)
  })

  it("generates and propagates correlation_id to emitted business events", async () => {
    const eventBus = { emit: jest.fn(async () => undefined) }
    const { scope } = makeScope(eventBus)

    const req = {
      headers: {},
      method: "POST",
      originalUrl: "/store/carts/cart_01/promotions",
      params: { id: "cart_01" },
      scope,
    } as any

    const res = {
      setHeader: jest.fn(),
    } as any

    await new Promise<void>((resolve, reject) => {
      correlationIdMiddleware(req, res, () => {
        emitBusinessEvent(scope as any, {
          name: "promotion.applied",
          workflow_name: "cart_apply_coupon",
          step_name: "emit_event",
          cart_id: "cart_01",
          data: {
            cart_id: "cart_01",
            promo_code: "SAVE10",
          },
        })
          .then(() => resolve())
          .catch(reject)
      })
    })

    expect(req.correlation_id).toEqual(expect.any(String))
    expect(req.correlation_id.length).toBeGreaterThan(10)

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "promotion.applied",
        data: expect.objectContaining({
          cart_id: "cart_01",
          promo_code: "SAVE10",
          correlation_id: req.correlation_id,
        }),
      })
    )
  })
})
