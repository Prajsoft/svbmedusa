"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
// Only load .env in development (not in Railway/Render)
if (process.env.NODE_ENV !== "production") {
    (0, utils_1.loadEnv)(process.env.NODE_ENV || "development", process.cwd());
}
const backendUrl = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000";
// Redis module config (production only — optional for dev)
const redisUrl = process.env.REDIS_URL;
const modules = {};
// Resend email notification provider
if (process.env.RESEND_API_KEY) {
    modules[utils_1.Modules.NOTIFICATION] = {
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
    };
}
// Cloudflare R2 file storage (only if R2 is configured)
if (process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID) {
    modules[utils_1.Modules.FILE] = {
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
    };
}
// Use Redis for event bus and caching in production
if (redisUrl) {
    modules[utils_1.Modules.EVENT_BUS] = {
        resolve: "@medusajs/event-bus-redis",
        options: {
            redisUrl,
        },
    };
    modules[utils_1.Modules.CACHE] = {
        resolve: "@medusajs/cache-redis",
        options: {
            redisUrl,
        },
    };
}
exports.default = (0, utils_1.defineConfig)({
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
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVkdXNhLWNvbmZpZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL21lZHVzYS1jb25maWcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxxREFBMEU7QUFFMUUsd0RBQXdEO0FBQ3hELElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEtBQUssWUFBWSxFQUFFLENBQUM7SUFDMUMsSUFBQSxlQUFPLEVBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLElBQUksYUFBYSxFQUFFLE9BQU8sQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFBO0FBQy9ELENBQUM7QUFFRCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixJQUFJLHVCQUF1QixDQUFBO0FBRTVFLDJEQUEyRDtBQUMzRCxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQTtBQUV0QyxNQUFNLE9BQU8sR0FBd0IsRUFBRSxDQUFBO0FBRXZDLHFDQUFxQztBQUNyQyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBYyxFQUFFLENBQUM7SUFDL0IsT0FBTyxDQUFDLGVBQU8sQ0FBQyxZQUFZLENBQUMsR0FBRztRQUM5QixPQUFPLEVBQUUsK0JBQStCO1FBQ3hDLE9BQU8sRUFBRTtZQUNQLFNBQVMsRUFBRTtnQkFDVDtvQkFDRSxPQUFPLEVBQUUsc0JBQXNCO29CQUMvQixFQUFFLEVBQUUsUUFBUTtvQkFDWixPQUFPLEVBQUU7d0JBQ1AsUUFBUSxFQUFFLENBQUMsT0FBTyxDQUFDO3dCQUNuQixPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjO3dCQUNuQyxJQUFJLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsSUFBSSx1QkFBdUI7cUJBQy9EO2lCQUNGO2FBQ0Y7U0FDRjtLQUNGLENBQUE7QUFDSCxDQUFDO0FBRUQsd0RBQXdEO0FBQ3hELElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO0lBQzVELE9BQU8sQ0FBQyxlQUFPLENBQUMsSUFBSSxDQUFDLEdBQUc7UUFDdEIsT0FBTyxFQUFFLGdCQUFnQjtRQUN6QixPQUFPLEVBQUU7WUFDUCxTQUFTLEVBQUU7Z0JBQ1Q7b0JBQ0UsT0FBTyxFQUFFLG1CQUFtQjtvQkFDNUIsRUFBRSxFQUFFLElBQUk7b0JBQ1IsT0FBTyxFQUFFO3dCQUNQLFFBQVEsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVc7d0JBQ2pDLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFNBQVM7d0JBQzdCLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFNBQVMsSUFBSSxNQUFNO3dCQUN2QyxhQUFhLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0I7d0JBQzNDLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQW9CO3dCQUVuRCxRQUFRLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhO3dCQUNuQyxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhO3dCQUNqQyxVQUFVLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhO3dCQUVyQyx3QkFBd0IsRUFBRTs0QkFDeEIsY0FBYyxFQUFFLElBQUk7eUJBQ3JCO3FCQUNGO2lCQUNGO2FBQ0Y7U0FDRjtLQUNGLENBQUE7QUFDSCxDQUFDO0FBRUQsb0RBQW9EO0FBQ3BELElBQUksUUFBUSxFQUFFLENBQUM7SUFDYixPQUFPLENBQUMsZUFBTyxDQUFDLFNBQVMsQ0FBQyxHQUFHO1FBQzNCLE9BQU8sRUFBRSwyQkFBMkI7UUFDcEMsT0FBTyxFQUFFO1lBQ1AsUUFBUTtTQUNUO0tBQ0YsQ0FBQTtJQUVELE9BQU8sQ0FBQyxlQUFPLENBQUMsS0FBSyxDQUFDLEdBQUc7UUFDdkIsT0FBTyxFQUFFLHVCQUF1QjtRQUNoQyxPQUFPLEVBQUU7WUFDUCxRQUFRO1NBQ1Q7S0FDRixDQUFBO0FBQ0gsQ0FBQztBQUVELGtCQUFlLElBQUEsb0JBQVksRUFBQztJQUMxQixhQUFhLEVBQUU7UUFDYixXQUFXLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFZO1FBQ3JDLGVBQWUsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsS0FBSyxhQUFhO1FBQ3ZELFFBQVE7UUFDUixJQUFJLEVBQUU7WUFDSixTQUFTLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksdUJBQXVCO1lBQzVELFNBQVMsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSx1QkFBdUI7WUFDNUQsUUFBUSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxJQUFJLHVCQUF1QjtZQUMxRCxTQUFTLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksYUFBYTtZQUNsRCxZQUFZLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLElBQUksYUFBYTtTQUN6RDtLQUNGO0lBRUQsS0FBSyxFQUFFO1FBQ0wsVUFBVTtRQUNWLE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsS0FBSyxNQUFNO0tBQzlDO0lBRUQsT0FBTztDQUNSLENBQUMsQ0FBQSJ9