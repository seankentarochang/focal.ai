import { createQlooClient, type QlooClient } from "@focal-ai/qloo";

let client: QlooClient | undefined;

export function getQlooClient(): QlooClient {
  if (client === undefined) {
    client = createQlooClient();
  }
  return client;
}

export function dataSource(): "live" | "mock" {
  return process.env.QLOO_MOCK === "1" ? "mock" : "live";
}
