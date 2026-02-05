import { loadEnv, defineConfig } from "@medusajs/framework/utils"

// Only load .env in development (not in Railway)
if (process.env.NODE_ENV !== "production") {
  loadEnv(process.env.NODE_ENV || "development", process.cwd())
}

export default defineConfig({
  modules: [
    {
      resolve: "@medusajs/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/file-s3",
            id: "s3",
            options: {
              endpoint: process.env.R2_ENDPOINT,
              bucket: process.env.R2_BUCKET,
              region: "us-east-1",
              access_key_id: process.env.R2_ACCESS_KEY_ID,
              secret_access_key: process.env.R2_SECRET_ACCESS_KEY,
              
              file_url: "https://pub-4172489d0b754592aca274982581448a.r2.dev",
              s3_url: "https://pub-4172489d0b754592aca274982581448a.r2.dev",
              public_url: "https://pub-4172489d0b754592aca274982581448a.r2.dev",
              
              additional_client_config: {
                forcePathStyle: true,
              },
            },
          },
        ],
      },
    },
  ],

  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS || "http://localhost:8000",
      adminCors: process.env.ADMIN_CORS || "http://localhost:7001",
      authCors: process.env.AUTH_CORS || "http://localhost:7001",
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
})