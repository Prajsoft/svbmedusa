import {
  PaymentProviderError,
  PaymentStatus,
  type PaymentTransitionValidator,
} from "../contracts"
import {
  logPaymentStateChange,
  isPaymentStatusTransitionAllowed,
  normalizePaymentStatus,
  transitionPaymentStatus,
} from "../state-machine"
import {
  applyTransition,
  canTransition,
} from "../../../../payments/stateMachine"

describe("payments-core state machine", () => {
  const ALL_STATUSES = [
    PaymentStatus.PENDING,
    PaymentStatus.AUTHORIZED,
    PaymentStatus.CAPTURED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
    PaymentStatus.REFUNDED,
  ] as const

  const ALLOWED_TRANSITIONS: Record<string, ReadonlySet<string>> = {
    [PaymentStatus.PENDING]: new Set([
      PaymentStatus.AUTHORIZED,
      PaymentStatus.CAPTURED,
      PaymentStatus.FAILED,
      PaymentStatus.CANCELLED,
    ]),
    [PaymentStatus.AUTHORIZED]: new Set([
      PaymentStatus.CAPTURED,
      PaymentStatus.FAILED,
      PaymentStatus.CANCELLED,
    ]),
    [PaymentStatus.CAPTURED]: new Set([PaymentStatus.REFUNDED]),
    [PaymentStatus.FAILED]: new Set(),
    [PaymentStatus.CANCELLED]: new Set(),
    [PaymentStatus.REFUNDED]: new Set(),
  }

  const expectedTransitionValidity = (from: string, to: string): boolean => {
    if (from === to) {
      return true
    }

    return ALLOWED_TRANSITIONS[from]?.has(to) ?? false
  }

  it("exposes transition validator signature and canTransition parity", () => {
    const validator: PaymentTransitionValidator = (current, next): boolean =>
      isPaymentStatusTransitionAllowed(current, next)

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected = expectedTransitionValidity(from, to)

        expect(typeof validator(from, to)).toBe("boolean")
        expect(validator(from, to)).toBe(expected)
        expect(canTransition(from, to)).toBe(expected)
      }
    }
  })

  it("applies all valid transitions and no-ops for same-state transitions", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (!expectedTransitionValidity(from, to)) {
          continue
        }

        const correlationId = `corr_state_valid_${from}_${to}`
        const direct = applyTransition(from, to, {
          correlation_id: correlationId,
        })
        const wrapped = transitionPaymentStatus({
          current: from,
          next: to,
          correlation_id: correlationId,
        })

        if (from === to) {
          expect(direct).toEqual({
            from,
            to,
            changed: false,
            idempotent: true,
            valid: true,
          })
          expect(wrapped).toEqual({
            current: from,
            next: to,
            changed: false,
            idempotent: true,
            valid: true,
          })
          continue
        }

        expect(direct).toEqual({
          from,
          to,
          changed: true,
          idempotent: false,
          valid: true,
        })
        expect(wrapped).toEqual({
          current: from,
          next: to,
          changed: true,
          idempotent: false,
          valid: true,
        })
      }
    }
  })

  it("throws STATE_TRANSITION_INVALID with correlation_id on illegal transitions", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (expectedTransitionValidity(from, to)) {
          continue
        }

        const correlationId = `corr_state_invalid_${from}_${to}`
        let directError: unknown
        let wrappedError: unknown

        try {
          applyTransition(from, to, {
            correlation_id: correlationId,
          })
        } catch (error) {
          directError = error
        }

        try {
          transitionPaymentStatus({
            current: from,
            next: to,
            correlation_id: correlationId,
          })
        } catch (error) {
          wrappedError = error
        }

        expect(directError).toBeInstanceOf(PaymentProviderError)
        expect((directError as PaymentProviderError).code).toBe(
          "STATE_TRANSITION_INVALID"
        )
        expect((directError as PaymentProviderError).correlation_id).toBe(
          correlationId
        )
        expect(wrappedError).toBeInstanceOf(PaymentProviderError)
        expect((wrappedError as PaymentProviderError).code).toBe(
          "STATE_TRANSITION_INVALID"
        )
        expect((wrappedError as PaymentProviderError).correlation_id).toBe(
          correlationId
        )
      }
    }
  })

  it("returns noop on invalid transition when configured", () => {
    const direct = applyTransition(PaymentStatus.CAPTURED, PaymentStatus.AUTHORIZED, {
      correlation_id: "corr_state_1",
      on_invalid: "noop",
    })

    const wrapped = transitionPaymentStatus({
      current: PaymentStatus.CAPTURED,
      next: PaymentStatus.AUTHORIZED,
      correlation_id: "corr_state_1",
      on_invalid: "noop",
    })

    expect(direct).toEqual({
      from: PaymentStatus.CAPTURED,
      to: PaymentStatus.CAPTURED,
      changed: false,
      idempotent: false,
      valid: false,
    })

    expect(wrapped).toEqual({
      current: PaymentStatus.CAPTURED,
      next: PaymentStatus.CAPTURED,
      changed: false,
      idempotent: false,
      valid: false,
    })
  })

  it("normalizes unknown values to PENDING", () => {
    expect(normalizePaymentStatus("authorized")).toBe(PaymentStatus.AUTHORIZED)
    expect(normalizePaymentStatus("cancelled")).toBe(PaymentStatus.CANCELLED)
    expect(normalizePaymentStatus("canceled")).toBe(PaymentStatus.CANCELLED)
    expect(normalizePaymentStatus("invalid_status")).toBe(PaymentStatus.PENDING)
  })

  it("logs payment state change with correlation_id and normalized statuses", () => {
    const logger = {
      info: jest.fn(),
    }

    const payload = logPaymentStateChange({
      payment_id: "pay_123",
      from: PaymentStatus.CANCELED,
      to: PaymentStatus.CAPTURED,
      source: "webhook",
      correlation_id: "corr_state_log_1",
      scopeOrLogger: logger,
    })

    expect(payload.correlation_id).toBe("corr_state_log_1")
    expect(payload.message).toBe("PAYMENT_STATE_CHANGE")

    expect(logger.info).toHaveBeenCalledTimes(1)

    const serialized = logger.info.mock.calls[0]?.[0]
    const parsed = JSON.parse(serialized)

    expect(parsed.correlation_id).toBe("corr_state_log_1")
    expect(parsed.message).toBe("PAYMENT_STATE_CHANGE")
    expect(parsed.meta.payment_id).toBe("pay_123")
    expect(parsed.meta.from).toBe(PaymentStatus.CANCELLED)
    expect(parsed.meta.to).toBe(PaymentStatus.CAPTURED)
    expect(parsed.meta.source).toBe("webhook")
  })
})
