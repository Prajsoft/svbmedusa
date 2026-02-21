import { z } from "zod"

const nonEmptyString = z.string().trim().min(1)

const isoDateTimeString = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime())

const currencyCodeSchema = z.string().trim().length(3).transform((value) => value.toUpperCase())

export const ShipmentStatus = {
  DRAFT: "DRAFT",
  BOOKING_IN_PROGRESS: "BOOKING_IN_PROGRESS",
  BOOKED: "BOOKED",
  PICKUP_SCHEDULED: "PICKUP_SCHEDULED",
  IN_TRANSIT: "IN_TRANSIT",
  OFD: "OFD",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  RTO_INITIATED: "RTO_INITIATED",
  RTO_IN_TRANSIT: "RTO_IN_TRANSIT",
  RTO_DELIVERED: "RTO_DELIVERED",
} as const

export type ShipmentStatus = (typeof ShipmentStatus)[keyof typeof ShipmentStatus]

export const shipmentStatusSchema = z.enum(
  Object.values(ShipmentStatus) as [ShipmentStatus, ...ShipmentStatus[]]
)

export const ProviderErrorCode = {
  AUTH_FAILED: "AUTH_FAILED",
  SERVICEABILITY_FAILED: "SERVICEABILITY_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  INVALID_ADDRESS: "INVALID_ADDRESS",
  SHIPMENT_NOT_FOUND: "SHIPMENT_NOT_FOUND",
  BOOKING_DISABLED: "BOOKING_DISABLED",
  CANNOT_CANCEL_IN_STATE: "CANNOT_CANCEL_IN_STATE",
  NOT_SUPPORTED: "NOT_SUPPORTED",
  SIGNATURE_INVALID: "SIGNATURE_INVALID",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
} as const

export type ProviderErrorCode = (typeof ProviderErrorCode)[keyof typeof ProviderErrorCode]

export const providerErrorCodeSchema = z.enum(
  Object.values(ProviderErrorCode) as [ProviderErrorCode, ...ProviderErrorCode[]]
)

export const ShippingProviderErrorSchema = z
  .object({
    code: providerErrorCodeSchema,
    message: nonEmptyString,
    details: z.record(z.string(), z.unknown()).default({}),
    correlation_id: nonEmptyString,
  })
  .strict()

export type ShippingProviderErrorObject = z.infer<typeof ShippingProviderErrorSchema>

export type ShippingProviderErrorEnvelope = {
  error: ShippingProviderErrorObject
}

export class ShippingProviderError extends Error {
  code: ProviderErrorCode
  details: Record<string, unknown>
  correlation_id: string

  constructor(input: {
    code: ProviderErrorCode
    message: string
    details?: Record<string, unknown>
    correlation_id: string
  }) {
    super(input.message)
    this.name = "ShippingProviderError"
    this.code = input.code
    this.details = input.details ?? {}
    this.correlation_id = input.correlation_id
  }

  toErrorObject(): ShippingProviderErrorObject {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      correlation_id: this.correlation_id,
    }
  }

  toErrorEnvelope(): ShippingProviderErrorEnvelope {
    return {
      error: this.toErrorObject(),
    }
  }
}

export const AddressSchema = z
  .object({
    name: nonEmptyString,
    phone: nonEmptyString,
    email: z.string().email().optional(),
    line1: nonEmptyString,
    line2: z.string().trim().optional(),
    city: nonEmptyString,
    state: nonEmptyString,
    postal_code: nonEmptyString,
    country_code: z.string().trim().length(2).transform((value) => value.toUpperCase()),
    landmark: z.string().trim().optional(),
  })
  .strict()

export type Address = z.infer<typeof AddressSchema>

export const ParcelDimensionsSchema = z
  .object({
    l: z.number().positive(),
    w: z.number().positive(),
    h: z.number().positive(),
  })
  .strict()

export const ParcelSchema = z
  .object({
    weight_grams: z.number().positive(),
    dimensions_cm: ParcelDimensionsSchema,
    declared_value: z.number().nonnegative().optional(),
    description: z.string().trim().optional(),
  })
  .strict()

export type Parcel = z.infer<typeof ParcelSchema>

export const LineItemSchema = z
  .object({
    sku: nonEmptyString,
    name: nonEmptyString,
    qty: z.number().int().positive(),
    unit_price: z.number().nonnegative().optional(),
  })
  .strict()

export type LineItem = z.infer<typeof LineItemSchema>

const codSchema = z
  .object({
    enabled: z.boolean(),
    amount: z.number().nonnegative().default(0),
  })
  .strict()

export const QuoteRequestSchema = z
  .object({
    internal_reference: nonEmptyString.optional(),
    correlation_id: nonEmptyString.optional(),
    currency_code: currencyCodeSchema,
    pickup_address: AddressSchema,
    delivery_address: AddressSchema,
    parcels: z.array(ParcelSchema).min(1),
    line_items: z.array(LineItemSchema).optional(),
    cod: codSchema.optional(),
  })
  .strict()

export type QuoteRequest = z.infer<typeof QuoteRequestSchema>

export const QuoteOptionSchema = z
  .object({
    service_code: nonEmptyString,
    service_name: nonEmptyString,
    price: z.number().nonnegative(),
    currency_code: currencyCodeSchema,
    eta_days: z.number().int().positive().optional(),
    cod_supported: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const QuoteResponseSchema = z
  .object({
    quotes: z.array(QuoteOptionSchema),
  })
  .strict()

export type QuoteResponse = z.infer<typeof QuoteResponseSchema>

export const CreateShipmentRequestSchema = z
  .object({
    internal_reference: nonEmptyString,
    idempotency_key: nonEmptyString,
    correlation_id: nonEmptyString.optional(),
    order_reference: nonEmptyString,
    currency_code: currencyCodeSchema,
    pickup_address: AddressSchema,
    delivery_address: AddressSchema,
    parcels: z.array(ParcelSchema).min(1),
    line_items: z.array(LineItemSchema).min(1),
    cod: codSchema.default({
      enabled: false,
      amount: 0,
    }),
    notes: z.string().trim().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export type CreateShipmentRequest = z.infer<typeof CreateShipmentRequestSchema>

export const LabelResponseSchema = z
  .object({
    shipment_id: nonEmptyString,
    label_url: z.string().url(),
    mime_type: nonEmptyString.default("application/pdf"),
    label_expires_at: isoDateTimeString.optional(),
    regenerated: z.boolean().default(false),
  })
  .strict()

export type LabelResponse = z.infer<typeof LabelResponseSchema>

export const CreateShipmentResponseSchema = z
  .object({
    shipment_id: nonEmptyString,
    tracking_number: nonEmptyString.optional(),
    tracking_url: z.string().url().optional(),
    status: shipmentStatusSchema,
    label: LabelResponseSchema.optional(),
    booked_at: isoDateTimeString.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export type CreateShipmentResponse = z.infer<typeof CreateShipmentResponseSchema>

export const GetLabelRequestSchema = z
  .object({
    shipment_id: nonEmptyString,
    regenerate_if_expired: z.boolean().default(true),
    correlation_id: nonEmptyString.optional(),
  })
  .strict()

export type GetLabelRequest = z.infer<typeof GetLabelRequestSchema>

export const TrackRequestSchema = z
  .object({
    shipment_id: nonEmptyString.optional(),
    tracking_number: nonEmptyString.optional(),
    internal_reference: nonEmptyString.optional(),
    correlation_id: nonEmptyString.optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(
        value.shipment_id || value.tracking_number || value.internal_reference
      ),
    {
      message:
        "At least one of shipment_id, tracking_number, or internal_reference is required",
    }
  )

export type TrackRequest = z.infer<typeof TrackRequestSchema>

export const TrackingEventSchema = z
  .object({
    status: shipmentStatusSchema,
    occurred_at: isoDateTimeString,
    location: z.string().trim().optional(),
    message: z.string().trim().optional(),
    raw_status: z.string().trim().optional(),
  })
  .strict()

export const TrackingResponseSchema = z
  .object({
    shipment_id: nonEmptyString,
    tracking_number: nonEmptyString.optional(),
    status: shipmentStatusSchema,
    events: z.array(TrackingEventSchema),
  })
  .strict()

export type TrackingResponse = z.infer<typeof TrackingResponseSchema>

export const CancelRequestSchema = z
  .object({
    shipment_id: nonEmptyString,
    reason: z.string().trim().optional(),
    correlation_id: nonEmptyString.optional(),
  })
  .strict()

export type CancelRequest = z.infer<typeof CancelRequestSchema>

export const CancelResponseSchema = z
  .object({
    shipment_id: nonEmptyString,
    cancelled: z.boolean(),
    status: shipmentStatusSchema,
    cancelled_at: isoDateTimeString.optional(),
  })
  .strict()

export type CancelResponse = z.infer<typeof CancelResponseSchema>

export const HealthCheckResponseSchema = z
  .object({
    ok: z.boolean(),
    provider: nonEmptyString,
    checked_at: isoDateTimeString,
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>

export const LookupShipmentByReferenceRequestSchema = z
  .object({
    internal_reference: nonEmptyString,
    correlation_id: nonEmptyString.optional(),
  })
  .strict()

export type LookupShipmentByReferenceRequest = z.infer<
  typeof LookupShipmentByReferenceRequestSchema
>

export const ProviderCapabilitiesSchema = z
  .object({
    supports_cod: z.boolean(),
    supports_reverse: z.boolean(),
    supports_label_regen: z.boolean(),
    supports_webhooks: z.boolean(),
    supports_cancel: z.boolean(),
    supports_multi_piece: z.boolean(),
    supports_idempotency: z.boolean().default(false),
    supports_reference_lookup: z.boolean().default(false),
  })
  .strict()

export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>

export interface ShippingProvider {
  readonly provider: string
  readonly capabilities: ProviderCapabilities
  quote(input: QuoteRequest): Promise<QuoteResponse>
  createShipment(input: CreateShipmentRequest): Promise<CreateShipmentResponse>
  getLabel(input: GetLabelRequest): Promise<LabelResponse>
  track(input: TrackRequest): Promise<TrackingResponse>
  cancel(input: CancelRequest): Promise<CancelResponse>
  healthCheck(): Promise<HealthCheckResponse>
  findShipmentByReference?(
    input: LookupShipmentByReferenceRequest
  ): Promise<CreateShipmentResponse | null>
  verifyWebhook?(request: {
    headers: Record<string, string | string[] | undefined>
    raw_body: string
    body?: unknown
  }): boolean | Promise<boolean>
}

export function validateQuoteRequest(input: unknown): QuoteRequest {
  return QuoteRequestSchema.parse(input)
}

export function validateCreateShipmentRequest(input: unknown): CreateShipmentRequest {
  return CreateShipmentRequestSchema.parse(input)
}

export function validateGetLabelRequest(input: unknown): GetLabelRequest {
  return GetLabelRequestSchema.parse(input)
}

export function validateTrackRequest(input: unknown): TrackRequest {
  return TrackRequestSchema.parse(input)
}

export function validateCancelRequest(input: unknown): CancelRequest {
  return CancelRequestSchema.parse(input)
}

export function validateLookupShipmentByReferenceRequest(
  input: unknown
): LookupShipmentByReferenceRequest {
  return LookupShipmentByReferenceRequestSchema.parse(input)
}
