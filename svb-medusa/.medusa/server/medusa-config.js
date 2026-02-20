"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
const observability_1 = require("./src/modules/observability");
// Only load .env in development (not in Railway/Render)
(0, utils_1.loadEnv)(process.env.NODE_ENV || "development", process.cwd());
const backendUrl = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000";
// Redis module config (production only — optional for dev)
const redisUrl = process.env.REDIS_URL;
const modules = {};
modules[observability_1.OBSERVABILITY_MODULE] = {
    resolve: "./src/modules/observability",
};
modules[utils_1.Modules.PAYMENT] = {
    resolve: "@medusajs/payment",
    options: {
        providers: [
            {
                resolve: "./src/modules/payment-cod",
                id: "cod",
            },
        ],
    },
};
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
        disable: false,
    },
    modules,
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVkdXNhLWNvbmZpZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL21lZHVzYS1jb25maWcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxxREFBMEU7QUFDMUUsK0RBQWtFO0FBRWxFLHdEQUF3RDtBQUV0RCxJQUFBLGVBQU8sRUFBQyxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsSUFBSSxhQUFhLEVBQUUsT0FBTyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUE7QUFHL0QsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSx1QkFBdUIsQ0FBQTtBQUU1RSwyREFBMkQ7QUFDM0QsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUE7QUFFdEMsTUFBTSxPQUFPLEdBQXdCLEVBQUUsQ0FBQTtBQUV2QyxPQUFPLENBQUMsb0NBQW9CLENBQUMsR0FBRztJQUM5QixPQUFPLEVBQUUsNkJBQTZCO0NBQ3ZDLENBQUE7QUFFRCxPQUFPLENBQUMsZUFBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHO0lBQ3pCLE9BQU8sRUFBRSxtQkFBbUI7SUFDNUIsT0FBTyxFQUFFO1FBQ1AsU0FBUyxFQUFFO1lBQ1Q7Z0JBQ0UsT0FBTyxFQUFFLDJCQUEyQjtnQkFDcEMsRUFBRSxFQUFFLEtBQUs7YUFDVjtTQUNGO0tBQ0Y7Q0FDRixDQUFBO0FBRUQscUNBQXFDO0FBQ3JDLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjLEVBQUUsQ0FBQztJQUMvQixPQUFPLENBQUMsZUFBTyxDQUFDLFlBQVksQ0FBQyxHQUFHO1FBQzlCLE9BQU8sRUFBRSwrQkFBK0I7UUFDeEMsT0FBTyxFQUFFO1lBQ1AsU0FBUyxFQUFFO2dCQUNUO29CQUNFLE9BQU8sRUFBRSxzQkFBc0I7b0JBQy9CLEVBQUUsRUFBRSxRQUFRO29CQUNaLE9BQU8sRUFBRTt3QkFDUCxRQUFRLEVBQUUsQ0FBQyxPQUFPLENBQUM7d0JBQ25C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