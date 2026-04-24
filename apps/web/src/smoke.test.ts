import { describe, expect, it } from "vitest";

describe("web smoke", () => {
  it("runs tests in CI", () => {
    expect(1 + 1).toBe(2);
  });
});
