import {
  ProviderErrorCode,
  ShippingProviderError,
} from "../../../integrations/carriers/provider-contract"
import { processCarrierWebhook } from "../webhook-pipeline"

describe("processCarrierWebhook", () => {
  it("rejects webhook when signature verifier is missing", async () => {
    const repository = {
      processShippingWebhookEvent: jest.fn(),
    }

    await expect(
      processCarrierWebhook({
        provider: "fake",
        provider_event_id: "evt_1",
        event_type: "booked",
        correlation_id: "corr_1",
        repository: repository as any,
      })
    ).rejects.toMatchObject<ShippingProviderError>({
      code: ProviderErrorCode.SIGNATURE_INVALID,
    })
    expect(repository.processShippingWebhookEvent).not.toHaveBeenCalled()
  })

  it("rejects webhook when signature verification fails", async () => {
    const repository = {
      processShippingWebhookEvent: jest.fn(),
    }
    const verifySignature = jest.fn().mockResolvedValue(false)

    await expect(
      processCarrierWebhook({
        provider: "fake",
        provider_event_id: "evt_2",
        event_type: "booked",
        correlation_id: "corr_2",
        repository: repository as any,
        verify_signature: verifySignature,
        raw_body: "{\"event\":\"booked\"}",
      })
    ).rejects.toMatchObject<ShippingProviderError>({
      code: ProviderErrorCode.SIGNATURE_INVALID,
    })
    expect(repository.processShippingWebhookEvent).not.toHaveBeenCalled()
  })

  it("processes webhook when signature verification succeeds", async () => {
    const repository = {
      processShippingWebhookEvent: jest.fn().mockResolvedValue({
        processed: true,
        deduped: false,
        buffered: false,
        matched: true,
        shipment_id: "ship_1",
        status_updated: true,
      }),
    }
    const verifySignature = jest.fn().mockResolvedValue(true)

    const result = await processCarrierWebhook({
      provider: "fake",
      provider_event_id: "evt_3",
      provider_shipment_id: "provider_ship_3",
      provider_awb: "awb_3",
      event_type: "in_transit",
      payload: {
        status: "in_transit",
      },
      correlation_id: "corr_3",
      repository: repository as any,
      verify_signature: verifySignature,
      raw_body: "{\"event\":\"in_transit\"}",
      headers: {
        "x-fake-carrier-signature": "sig_1",
      },
    })

    expect(verifySignature).toHaveBeenCalled()
    expect(repository.processShippingWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "fake",
        provider_event_id: "evt_3",
        provider_shipment_id: "provider_ship_3",
        provider_awb: "awb_3",
        event_type: "in_transit",
        payload_sanitized: {
          status: "in_transit",
        },
      })
    )
    expect(result.matched).toBe(true)
  })
})
