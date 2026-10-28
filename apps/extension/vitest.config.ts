import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Non-focal host so content.ts's eligibility guard passes in tests.
    environmentOptions: { jsdom: { url: "https://www.yelp.com/search" } },
  },
});
