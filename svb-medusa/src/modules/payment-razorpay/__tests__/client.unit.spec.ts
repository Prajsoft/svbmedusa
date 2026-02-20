import {
  __unsafeResetRazorpayClientForTests,
  RazorpayApiCallError,
  getRazorpayClient,
  razorpayRequest,
} from "../client"

describe("Razorpay client + request wrapper", () => {
  afterEach(() => {
    __unsafeResetRazorpayClientForTests()
    jest.restoreAllMocks()
  })

  it("returns a canonical cached client for the same credentials", () => {
    const first = getRazorpayClient({
      keyId: "rzp_test_client_1",
      keySecret: "secret_1",
    })
    const second = getRazorpayClient({
      keyId: "rzp_test_client_1",
      keySecret: "secret_1",
    })

    expect(first).toBe(second)
  })

  it("retries on 429 and then succeeds", async () => {
    const call = jest
      .fn()
      .mockRejectedValueOnce({
        statusCode: 429,
        error: {
          code: "RATE_LIMITED",
          description: "Too many requests",
        },
      })
      .mockResolvedValueOnce({ id: "order_429_ok" })

    const result = await razorpayRequest(
      call,
      {
        correlation_id: "corr_429",
        endpoint: "orders.create",
      },
      {
        sleep: async () => undefined,
        random: () => 0,
      }
    )

    expect(result).toEqual({ id: "order_429_ok" })
    expect(call).toHaveBeenCalledTimes(2)
  })

  it("supports per-call retry policy to disable retry on 429", async () => {
    const call = jest.fn().mockRejectedValue({
      statusCode: 429,
      error: {
        code: "RATE_LIMITED",
        description: "Too many requests",
      },
    })

    await expect(
      razorpayRequest(
        call,
        {
          correlation_id: "corr_429_no_retry",
          endpoint: "orders.create",
        },
        {
          sleep: async () => undefined,
          random: () => 0,
          shouldRetry: ({ status }) => status !== 429,
        }
      )
    ).rejects.toMatchObject({
      code: "RAZORPAY_API_CALL_FAILED",
      http_status: 429,
      endpoint: "orders.create",
      correlation_id: "corr_429_no_retry",
    })

    expect(call).toHaveBeenCalledTimes(1)
  })

  it("retries on 500 and then succeeds", async () => {
    const call = jest
      .fn()
      .mockRejectedValueOnce({
        statusCode: 500,
        error: {
          code: "SERVER_ERROR",
          description: "Upstream failed",
        },
      })
      .mockResolvedValueOnce({ id: "order_500_ok" })

    const result = await razorpayRequest(
      call,
      {
        correlation_id: "corr_500",
        endpoint: "orders.create",
      },
      {
        sleep: async () => undefined,
        random: () => 0,
      }
    )

    expect(result).toEqual({ id: "order_500_ok" })
    expect(call).toHaveBeenCalledTimes(2)
  })

  it("fails immediately on 401 (no retry) and logs RAZORPAY_API_CALL_FAILED", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined)
    const call = jest.fn().mockRejectedValue({
      statusCode: 401,
      error: {
        code: "BAD_REQUEST_ERROR",
        description: "Authentication failed",
      },
    })

    await expect(
      razorpayRequest(
        call,
        {
          correlation_id: "corr_401",
          endpoint: "payments.fetch",
        },
        {
          sleep: async () => undefined,
          random: () => 0,
        }
      )
    ).rejects.toMatchObject({
      code: "RAZORPAY_API_CALL_FAILED",
      http_status: 401,
      endpoint: "payments.fetch",
      correlation_id: "corr_401",
    })

    expect(call).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)

    const payload = JSON.parse(String(consoleErrorSpy.mock.calls[0]?.[0] ?? "{}"))
    expect(payload).toEqual(
      expect.objectContaining({
        message: "RAZORPAY_API_CALL_FAILED",
        correlation_id: "corr_401",
        meta: expect.objectContaining({
          endpoint: "payments.fetch",
          status: 401,
        }),
      })
    )
  })

  it("throws typed RazorpayApiCallError", async () => {
    const call = jest.fn().mockRejectedValue({
      code: "ENOTFOUND",
      message: "socket hang up",
    })

    await expect(
      razorpayRequest(
        call,
        {
          correlation_id: "corr_network",
          endpoint: "orders.create",
        },
        {
          sleep: async () => undefined,
          random: () => 0,
        }
      )
    ).rejects.toBeInstanceOf(RazorpayApiCallError)
  })
})
