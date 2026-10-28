// jsdom synthetic clicks are untrusted — R9-8's isTrusted guard would bail
// every test that .click()s. Restore the default trust check per test.
import { beforeEach } from "vitest";
import { __setTrustCheckForTests } from "../src/apply/apply";
import { __setGateTrustCheckForTests } from "../src/apply/gate";

beforeEach(() => {
  __setTrustCheckForTests(() => true);
  __setGateTrustCheckForTests(() => true);
});
