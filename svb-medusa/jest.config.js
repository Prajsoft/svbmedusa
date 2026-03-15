const { loadEnv } = require("@medusajs/utils");
loadEnv("test", process.cwd());

module.exports = {
  transform: {
    "^.+\\.[jt]sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", decorators: true, tsx: true },
          transform: { react: { runtime: "automatic" } },
        },
      },
    ],
  },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "ts", "tsx", "json"],
  modulePathIgnorePatterns: ["dist/", "<rootDir>/.medusa/"],
  setupFiles: ["./integration-tests/setup.js"],
};

if (process.env.TEST_TYPE === "integration:http") {
  module.exports.testMatch = ["**/integration-tests/http/*.spec.[jt]s?(x)"];
} else if (process.env.TEST_TYPE === "integration:modules") {
  module.exports.testMatch = ["**/src/modules/*/__tests__/**/*.[jt]s?(x)"];
} else if (process.env.TEST_TYPE === "unit") {
  module.exports.testMatch = [
    "**/src/**/__tests__/**/*.unit.spec.[jt]s?(x)",
    "**/src/**/*.test.[jt]s?(x)",
  ];
  // Exclude backend API integration tests that require a live DB and server.
  // Run them with TEST_TYPE=integration:http when the stack is up.
  module.exports.testPathIgnorePatterns = [
    ...(module.exports.testPathIgnorePatterns ?? []),
    "<rootDir>/src/tests/sports-attributes-api.test.ts",
    "<rootDir>/src/tests/sports-attributes-batch-api.test.ts",
    "<rootDir>/src/tests/sports-filter-api.test.ts",
  ];
}
