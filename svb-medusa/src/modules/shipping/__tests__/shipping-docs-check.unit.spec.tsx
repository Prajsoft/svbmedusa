const { runShippingDocsCheck } = require("../../../../scripts/check-shipping-docs")

describe("shipping docs checks", () => {
  it("ensures Shiprocket docs include required env vars, routes, and QA cases", () => {
    const result = runShippingDocsCheck(process.cwd())
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
  })
})

