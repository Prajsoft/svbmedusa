import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  res.status(200).json({
    service: "svb-medusa",
    status: "ok",
    health: "/health",
  })
}

export async function HEAD(_req: MedusaRequest, res: MedusaResponse) {
  res.status(200).end()
}
