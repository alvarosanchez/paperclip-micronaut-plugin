import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

describe("micronaut plugin scaffold", () => {
  it("initializes as an empty plugin", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities]
    });

    await expect(plugin.definition.setup(harness.ctx)).resolves.toBeUndefined();
    expect(manifest.capabilities).toEqual(["instance.settings.register"]);
    expect(manifest.ui?.slots ?? []).toHaveLength(0);
  });
});
