import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ShippingProvider } from "../../integrations/carriers/provider-contract"
import { FakeShippingProvider } from "../../integrations/carriers/fake-provider"
import { ShippingProviderRouter } from "../../integrations/carriers/router"
import { ShiprocketProvider } from "../../integrations/carriers/shiprocket"
import { ShippingPersistenceRepository } from "./shipment-persistence"

type ScopeLike = {
  resolve: (key: string) => any
}

type PgConnectionLike = {
  raw: (query: string, bindings?: unknown[]) => Promise<{
    rows?: Array<Record<string, unknown>>
  }>
}

type CreateRouterInput = {
  providers?: Record<string, ShippingProvider>
  repository?: ShippingPersistenceRepository
  env?: NodeJS.ProcessEnv
  scopeOrLogger?: unknown
}

function getPgConnection(scope: ScopeLike): PgConnectionLike {
  const connection = scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as PgConnectionLike
  if (!connection || typeof connection.raw !== "function") {
    throw new Error("PG connection is unavailable for shipping operations.")
  }
  return connection
}

export function createShippingProviderRegistry(
  env: NodeJS.ProcessEnv = process.env
): Record<string, ShippingProvider> {
  const providers: Record<string, ShippingProvider> = {
    fake: new FakeShippingProvider(),
  }

  // Register Shiprocket under both key aliases; runtime routing remains provider-driven.
  const shiprocket = new ShiprocketProvider({ env })
  providers.shiprocket = shiprocket
  providers.sr = shiprocket

  return providers
}

export function getShippingPersistenceRepository(
  scope: ScopeLike,
  existing?: ShippingPersistenceRepository
): ShippingPersistenceRepository {
  if (existing) {
    return existing
  }

  const pgConnection = getPgConnection(scope)
  return new ShippingPersistenceRepository(pgConnection)
}

export function createShippingProviderRouter(
  scope: ScopeLike,
  input: CreateRouterInput = {}
): {
  repository: ShippingPersistenceRepository
  router: ShippingProviderRouter
} {
  const repository = getShippingPersistenceRepository(scope, input.repository)
  const providers = input.providers ?? createShippingProviderRegistry(input.env)
  let scopeOrLogger = input.scopeOrLogger
  if (!scopeOrLogger) {
    try {
      scopeOrLogger = scope.resolve("logger")
    } catch {
      scopeOrLogger = undefined
    }
  }

  const router = new ShippingProviderRouter({
    providers,
    shipment_repository: repository,
    env: input.env ?? process.env,
    scopeOrLogger,
  })

  return {
    repository,
    router,
  }
}
