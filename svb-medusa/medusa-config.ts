import { loadEnv, defineConfig, Modules } from "@medusajs/framework/utils"

// Only load .env in development (not in Railway/Render)
if (process.env.NODE_ENV !== "production") {
  loadEnv(process.env.NODE_ENV || "development", process.cwd())
}

const backendUrl = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"

// Redis module config (production only — optional for dev)
const redisUrl = process.env.REDIS_URL

const modules: Record<string, any> = {
  // Resend email notification provider
  [Modules.NOTIFICATION]: {
    resolve: "@medusajs/medusa/notification",
    options: {
      providers: [
        {
          resolve: "./src/modules/resend",
          id: "resend",
          options: {
            channels: ["email"],
            api_key: process.env.RESEND_API_KEY,
            from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
          },
        },
      ],
    },
  },

  // Cloudflare R2 file storage
  [Modules.FILE]: {
    resolve: "@medusajs/file",
    options: {
      providers: [
        {
          resolve: "@medusajs/file-s3",
          id: "s3",
          options: {
            endpoint: process.env.R2_ENDPOINT,
            bucket: process.env.R2_BUCKET,
            region: process.env.R2_REGION || "auto",
            access_key_id: process.env.R2_ACCESS_KEY_ID,
            secret_access_key: process.env.R2_SECRET_ACCESS_KEY,

            file_url: process.env.R2_PUBLIC_URL,
            s3_url: process.env.R2_PUBLIC_URL,
            public_url: process.env.R2_PUBLIC_URL,

            additional_client_config: {
              forcePathStyle: true,
            },
          },
        },
      ],
    },
  },
}

// Use Redis for event bus and caching in production
if (redisUrl) {
  modules[Modules.EVENT_BUS] = {
    resolve: "@medusajs/event-bus-redis",
    options: {
      redisUrl,
    },
  }

  modules[Modules.CACHE] = {
    resolve: "@medusajs/cache-redis",
    options: {
      redisUrl,
    },
  }
}

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    databaseLogging: process.env.NODE_ENV === "development",
    redisUrl,
    http: {
      storeCors: process.env.STORE_CORS || "http://localhost:8000",
      adminCors: process.env.ADMIN_CORS || "http://localhost:9000",
      authCors: process.env.AUTH_CORS || "http://localhost:8000",
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },

  admin: {
    backendUrl,
    disable: process.env.DISABLE_ADMIN === "true",
  },

  modules,
})