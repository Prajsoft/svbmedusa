import {
  ALLOW_UNSIGNED_WEBHOOKS_ENV,
  ALLOW_UNVERIFIED_WEBHOOKS_ENV,
  shouldAllowUnverifiedWebhook,
} from "../webhook-policy"

describe("payments-core webhook policy", () => {
  it("rejects unverified webhook by default", () => {
    expect(shouldAllowUnverifiedWebhook({ env: {} })).toBe(false)
  })

  it("allows explicit override via env flag", () => {
    expect(
      shouldAllowUnverifiedWebhook({
        env: {
          [ALLOW_UNVERIFIED_WEBHOOKS_ENV]: "true",
        },
      })
    ).toBe(true)
  })

  it("supports ALLOW_UNSIGNED_WEBHOOKS env alias", () => {
    expect(
      shouldAllowUnverifiedWebhook({
        env: {
          [ALLOW_UNSIGNED_WEBHOOKS_ENV]: "true",
        },
      })
    ).toBe(true)
  })

  it("option override takes precedence over env", () => {
    expect(
      shouldAllowUnverifiedWebhook({
        allow_unverified_webhooks: false,
        env: {
          [ALLOW_UNVERIFIED_WEBHOOKS_ENV]: "true",
        },
      })
    ).toBe(false)

    expect(
      shouldAllowUnverifiedWebhook({
        allow_unverified_webhooks: true,
        env: {
          [ALLOW_UNVERIFIED_WEBHOOKS_ENV]: "false",
        },
      })
    ).toBe(true)
  })
})
