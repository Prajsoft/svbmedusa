import { GET as getProductFeedRoute } from "../product-feed/route"
import {
  FEED_DISABLED,
  INVALID_QUERY,
  UNAUTHORIZED,
} from "../../modules/product-feed/errors"
import { generateProductFeedWorkflow } from "../../workflows/generate-product-feed"

jest.mock("../../workflows/generate-product-feed", () => ({
  generateProductFeedWorkflow: jest.fn(),
}))

const mockedGenerateProductFeedWorkflow =
  generateProductFeedWorkflow as jest.MockedFunction<typeof generateProductFeedWorkflow>

function makeReq({
  query = {},
  headers = {},
  scope,
}: {
  query?: Record<string, unknown>
  headers?: Record<string, string>
  scope?: Record<string, unknown>
}) {
  const normalizedHeaders = Object.entries(headers).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      acc[key.toLowerCase()] = value
      return acc
    },
    {}
  )

  return {
    query,
    get(name: string) {
      return normalizedHeaders[name.toLowerCase()]
    },
    scope:
      scope ??
      ({
        resolve: jest.fn(() => ({
          error: jest.fn(),
        })),
      } as any),
  } as any
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status: jest.fn(function (code: number) {
      res.statusCode = code
      return res
    }),
    json: jest.fn(function (payload: unknown) {
      res.body = payload
      return res
    }),
    send: jest.fn(function (payload: unknown) {
      res.body = payload
      return res
    }),
    setHeader: jest.fn(function (name: string, value: string) {
      res.headers[name.toLowerCase()] = value
      return res
    }),
  }

  return res
}

describe("GET /product-feed safety controls", () => {
  const originalEnv = {
    ENABLE_PRODUCT_FEED: process.env.ENABLE_PRODUCT_FEED,
    PRODUCT_FEED_TOKEN: process.env.PRODUCT_FEED_TOKEN,
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterAll(() => {
    process.env.ENABLE_PRODUCT_FEED = originalEnv.ENABLE_PRODUCT_FEED
    process.env.PRODUCT_FEED_TOKEN = originalEnv.PRODUCT_FEED_TOKEN
  })

  it("returns FEED_DISABLED when the endpoint flag is off", async () => {
    process.env.ENABLE_PRODUCT_FEED = "false"
    process.env.PRODUCT_FEED_TOKEN = "token-123"

    const req = makeReq({
      query: {
        currency_code: "INR",
        country_code: "IN",
        token: "token-123",
      },
    })
    const res = makeRes()

    await getProductFeedRoute(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: FEED_DISABLED,
        message: "Product feed is disabled",
      },
    })
    expect(mockedGenerateProductFeedWorkflow).not.toHaveBeenCalled()
  })

  it("returns UNAUTHORIZED when token is invalid", async () => {
    process.env.ENABLE_PRODUCT_FEED = "true"
    process.env.PRODUCT_FEED_TOKEN = "token-123"

    const req = makeReq({
      query: {
        currency_code: "INR",
        country_code: "IN",
        token: "wrong-token",
      },
    })
    const res = makeRes()

    await getProductFeedRoute(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: UNAUTHORIZED,
        message: "Invalid token",
      },
    })
    expect(mockedGenerateProductFeedWorkflow).not.toHaveBeenCalled()
  })

  it("returns INVALID_QUERY for missing required query params", async () => {
    process.env.ENABLE_PRODUCT_FEED = "true"
    process.env.PRODUCT_FEED_TOKEN = "token-123"

    const req = makeReq({
      query: {
        token: "token-123",
        country_code: "IN",
      },
    })
    const res = makeRes()

    await getProductFeedRoute(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: INVALID_QUERY,
        message: "currency_code, country_code, token are required query parameters.",
      },
    })
  })

  it("returns XML when feature is enabled and token is valid", async () => {
    process.env.ENABLE_PRODUCT_FEED = "true"
    process.env.PRODUCT_FEED_TOKEN = "token-123"
    const mockXml =
      '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"></rss>'

    const run = jest.fn().mockResolvedValue({
      result: {
        xml: mockXml,
      },
    })
    mockedGenerateProductFeedWorkflow.mockReturnValue({
      run,
    } as any)

    const scope = {
      resolve: jest.fn(() => ({
        error: jest.fn(),
      })),
    }

    const req = makeReq({
      query: {
        currency_code: "INR",
        country_code: "IN",
        token: "token-123",
      },
      scope,
    })
    const res = makeRes()

    await getProductFeedRoute(req, res)

    expect(mockedGenerateProductFeedWorkflow).toHaveBeenCalledWith(scope)
    expect(run).toHaveBeenCalledWith({
      input: {
        currency_code: "INR",
        country_code: "IN",
      },
    })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/rss+xml; charset=utf-8"
    )
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, max-age=300"
    )
    expect(res.body).toBe(mockXml)
  })
})
