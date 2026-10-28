// jsdom synthetic clicks are untrusted — R9-8's isTrusted guard would bail
// every test that .click()s. Restore the default trust check per test.
import { beforeEach } from "vitest";
import { __setTrustCheckForTests } from "../src/apply/apply";

beforeEach(() => {
  __setTrustCheckForTests(() => true);
});
