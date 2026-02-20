import { logEvent } from "../log-event"

describe("logEvent", () => {
  it("redacts secrets and authorization headers", () => {
    const logger = {
      info: jest.fn(),
    }

    logEvent(
      "payment.provider.request",
      {
        authorization: "Bearer secret-token",
        api_key: "api-key-123",
        headers: {
          Authorization: "Bearer top-secret",
          "x-api-key": "key-value",
          "x-request-id": "req_123",
        },
        nested: {
          password: "my-password",
          safe_value: "ok",
        },
      },
      "corr_log_123",
      {
        scopeOrLogger: logger,
      }
    )

    expect(logger.info).toHaveBeenCalledTimes(1)

    const serialized = logger.info.mock.calls[0]?.[0]
    const parsed = JSON.parse(serialized)

    expect(parsed.correlation_id).toBe("corr_log_123")
    expect(parsed.message).toBe("payment.provider.request")
    expect(parsed.meta.authorization).toBe("[REDACTED]")
    expect(parsed.meta.api_key).toBe("[REDACTED]")
    expect(parsed.meta.headers.Authorization).toBe("[REDACTED]")
    expect(parsed.meta.headers["x-api-key"]).toBe("[REDACTED]")
    expect(parsed.meta.headers["x-request-id"]).toBe("req_123")
    expect(parsed.meta.nested.password).toBe("[REDACTED]")
    expect(parsed.meta.nested.safe_value).toBe("ok")
  })
})
