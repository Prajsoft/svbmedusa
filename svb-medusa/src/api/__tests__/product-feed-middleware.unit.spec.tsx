import middlewaresConfig from "../middlewares"

function makeReq(query: Record<string, unknown>) {
  return {
    query,
    path: "/product-feed",
    originalUrl: "/product-feed",
    scope: {
      resolve: jest.fn(() => ({
        error: jest.fn(),
        info: jest.fn(),
      })),
    },
  } as any
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as unknown,
    status: jest.fn(function (code: number) {
      res.statusCode = code
      return res
    }),
    json: jest.fn(function (payload: unknown) {
      res.body = payload
      return res
    }),
  }

  return res
}

describe("product-feed middleware query validation", () => {
  it("fails with INVALID_QUERY before route handler when currency_code is missing", async () => {
    const config = middlewaresConfig as any
    const productFeedRoute = (config.routes ?? []).find(
      (route: any) =>
        route.matcher === "/product-feed" &&
        Array.isArray(route.methods) &&
        route.methods.includes("GET")
    )

    expect(productFeedRoute).toBeDefined()
    const queryValidatorMiddleware = productFeedRoute.middlewares?.[0]
    expect(typeof queryValidatorMiddleware).toBe("function")

    const req = makeReq({
      country_code: "IN",
      token: "demo-token",
    })
    const res = makeRes()

    let handlerReached = false
    let capturedError: unknown

    await queryValidatorMiddleware(req, res, (error?: unknown) => {
      if (error) {
        capturedError = error
        return
      }

      handlerReached = true
    })

    expect(handlerReached).toBe(false)
    expect(capturedError).toBeDefined()

    await config.errorHandler(capturedError, req, res, jest.fn())

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "INVALID_QUERY",
        message: expect.stringContaining("currency_code"),
      },
    })
  })
})
