import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

export default defineConfig({
// medusa-config.ts

  modules: [
    {
      resolve: "@medusajs/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/file-s3",
            id: "s3", // Changed ID to standard 's3' just in case
            options: {
              // Connection Details
              endpoint: process.env.R2_ENDPOINT,
              bucket: process.env.R2_BUCKET,
              region: "us-east-1", // Change 'auto' to 'us-east-1' (Common R2 fix)
              access_key_id: process.env.R2_ACCESS_KEY_ID,
              secret_access_key: process.env.R2_SECRET_ACCESS_KEY,
              
              // 👇 THE SHOTGUN APPROACH: Set ALL of these to your R2 public URL
              file_url: "https://pub-4172489d0b754592aca274982581448a.r2.dev",
              s3_url: "https://pub-4172489d0b754592aca274982581448a.r2.dev",
              public_url: "https://pub-4172489d0b754592aca274982581448a.r2.dev",
              
              // Additional AWS SDK Config
              additional_client_config: {
                forcePathStyle: true, // CamelCase is vital here
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
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
})

