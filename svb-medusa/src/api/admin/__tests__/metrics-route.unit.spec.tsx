import { GET as getMetricsSnapshotRoute } from "../observability/metrics/route"
import {
  __resetMetricsForTests,
  increment,
} from "../../../modules/observability/metrics"

function makeRes() {
  const res: any = {
    statusCode: 200,
    json: jest.fn(function (_payload: any) {
      return res
    }),
    status: jest.fn(function (code: number) {
      res.statusCode = code
      return res
    }),
  }

  return res
}

describe("admin observability metrics route", () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    __resetMetricsForTests()
    process.env.NODE_ENV = originalNodeEnv
  })

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  it("is disabled outside development", async () => {
    process.env.NODE_ENV = "test"
    const res = makeRes()

    await getMetricsSnapshotRoute({} as any, res as any)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({
      code: "METRICS_SNAPSHOT_DISABLED",
      message: "Metrics snapshot endpoint is only available in development.",
    })
  })

  it("returns metrics snapshot in development", async () => {
    process.env.NODE_ENV = "development"
    increment("workflow.order_place.success_total", {
      workflow: "order_place",
      result: "success",
    })

    const res = makeRes()
    await getMetricsSnapshotRoute({} as any, res as any)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        metrics: expect.objectContaining({
          generated_at: expect.any(String),
          counters: expect.arrayContaining([
            expect.objectContaining({
              name: "workflow.order_place.success_total",
              value: 1,
            }),
          ]),
        }),
      })
    )
  })
})
