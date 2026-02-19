import crypto from "crypto"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"

const COD_STATE = {
  SESSION_CREATED: "session_created",
  AUTHORIZED: "authorized",
  CAPTURED: "captured",
  REFUNDED: "refunded",
  CANCELED: "canceled",
} as const

type CodState = (typeof COD_STATE)[keyof typeof COD_STATE]

const COD_STATES: CodState[] = Object.values(COD_STATE)

class CodPaymentProviderService extends AbstractPaymentProvider {
  static identifier = "cod"

  constructor(
    cradle: Record<string, unknown>,
    config?: Record<string, unknown>
  ) {
    super(cradle, config)
  }

  private cloneData(data?: Record<string, unknown>): Record<string, unknown> {
    return data ? { ...data } : {}
  }

  private normalizeState(data: Record<string, unknown>): CodState | undefined {
    const state = data.cod_state

    if (typeof state !== "string") {
      return undefined
    }

    return COD_STATES.includes(state as CodState)
      ? (state as CodState)
      : undefined
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const data = this.cloneData(input.data)
    const now = new Date().toISOString()
    const sessionId =
      typeof data.cod_session_id === "string"
        ? data.cod_session_id
        : crypto.randomUUID()
    const reference =
      typeof data.cod_reference === "string"
        ? data.cod_reference
        : `COD-${crypto.randomUUID()}`

    return {
      id: sessionId,
      status: PaymentSessionStatus.PENDING,
      data: {
        ...data,
        cod_session_id: sessionId,
        cod_reference: reference,
        cod_state: COD_STATE.SESSION_CREATED,
        initiated_at:
          typeof data.initiated_at === "string" ? data.initiated_at : now,
        amount: input.amount,
        currency_code: input.currency_code.toUpperCase(),
      },
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const data = this.cloneData(input.data)
    const state = this.normalizeState(data)

    if (state !== COD_STATE.CAPTURED && state !== COD_STATE.REFUNDED) {
      data.cod_state = COD_STATE.AUTHORIZED
    }

    if (typeof data.cod_reference !== "string") {
      data.cod_reference = `COD-${crypto.randomUUID()}`
    }

    if (typeof data.authorized_at !== "string") {
      data.authorized_at = new Date().toISOString()
    }

    return {
      status: PaymentSessionStatus.AUTHORIZED,
      data,
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const data = this.cloneData(input.data)
    const state = this.normalizeState(data)

    if (state !== COD_STATE.CAPTURED) {
      data.cod_state = COD_STATE.CAPTURED
    }

    if (typeof data.captured_at !== "string") {
      data.captured_at = new Date().toISOString()
    }

    return {
      data,
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = this.cloneData(input.data)
    const now = new Date().toISOString()
    const idempotencyKey = input.context?.idempotency_key
    const existingRecords = Array.isArray(data.refund_records)
      ? (data.refund_records as Array<Record<string, unknown>>)
      : []
    const refundRecords = [...existingRecords]
    const alreadyRecorded =
      typeof idempotencyKey === "string"
        ? refundRecords.some((record) => record.idempotency_key === idempotencyKey)
        : false

    if (!alreadyRecorded) {
      refundRecords.push({
        amount: input.amount,
        recorded_at: now,
        status: "recorded",
        idempotency_key: idempotencyKey,
      })
    }

    data.cod_state = COD_STATE.REFUNDED
    data.refund_records = refundRecords

    if (typeof data.refunded_at !== "string") {
      data.refunded_at = now
    }

    return {
      data,
    }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const data = this.cloneData(input.data)
    const state = this.normalizeState(data)

    switch (state) {
      case COD_STATE.AUTHORIZED:
        return { status: PaymentSessionStatus.AUTHORIZED, data }
      case COD_STATE.CAPTURED:
      case COD_STATE.REFUNDED:
        return { status: PaymentSessionStatus.CAPTURED, data }
      case COD_STATE.CANCELED:
        return { status: PaymentSessionStatus.CANCELED, data }
      default:
        return { status: PaymentSessionStatus.PENDING, data }
    }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return { data: this.cloneData(input.data) }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const data = this.cloneData(input.data)

    data.amount = input.amount
    data.currency_code = input.currency_code.toUpperCase()

    return { data }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: this.cloneData(input.data) }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const data = this.cloneData(input.data)

    data.cod_state = COD_STATE.CANCELED

    if (typeof data.canceled_at !== "string") {
      data.canceled_at = new Date().toISOString()
    }

    return { data }
  }

  async getWebhookActionAndData(
    _: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    return { action: PaymentActions.NOT_SUPPORTED }
  }
}

export default CodPaymentProviderService
