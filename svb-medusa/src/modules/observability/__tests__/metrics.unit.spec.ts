import {
  __resetMetricsForTests,
  getMetricsSnapshot,
  increment,
  observeDuration,
} from "../metrics"

describe("metrics registry", () => {
  beforeEach(() => {
    __resetMetricsForTests()
  })

  it("increments counters by name + labels", () => {
    increment("workflow.order_place.success_total", {
      workflow: "order_place",
      result: "success",
    })
    increment("workflow.order_place.success_total", {
      result: "success",
      workflow: "order_place",
    })

    const snapshot = getMetricsSnapshot()
    const counter = snapshot.counters.find(
      (entry) => entry.name === "workflow.order_place.success_total"
    )

    expect(counter).toEqual(
      expect.objectContaining({
        name: "workflow.order_place.success_total",
        labels: {
          workflow: "order_place",
          result: "success",
        },
        value: 2,
      })
    )
  })

  it("tracks duration aggregates for timers", () => {
    observeDuration("workflow.fulfillment_request.duration_ms", 120, {
      workflow: "fulfillment_request",
      result: "success",
    })
    observeDuration("workflow.fulfillment_request.duration_ms", 80, {
      workflow: "fulfillment_request",
      result: "success",
    })

    const snapshot = getMetricsSnapshot()
    const timer = snapshot.timers.find(
      (entry) => entry.name === "workflow.fulfillment_request.duration_ms"
    )

    expect(timer).toEqual(
      expect.objectContaining({
        count: 2,
        sum_ms: 200,
        min_ms: 80,
        max_ms: 120,
        last_ms: 80,
        avg_ms: 100,
      })
    )
  })

  it("clamps invalid durations to zero", () => {
    observeDuration("workflow.order_place.duration_ms", -15, {
      workflow: "order_place",
      result: "failure",
    })

    const snapshot = getMetricsSnapshot()
    const timer = snapshot.timers.find(
      (entry) => entry.name === "workflow.order_place.duration_ms"
    )

    expect(timer).toEqual(
      expect.objectContaining({
        count: 1,
        sum_ms: 0,
        min_ms: 0,
        max_ms: 0,
        last_ms: 0,
        avg_ms: 0,
      })
    )
  })
})
