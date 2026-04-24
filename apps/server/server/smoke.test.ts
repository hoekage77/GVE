import { describe, expect, it } from "vitest";

describe("server smoke", () => {
  it("runs tests in CI", () => {
    expect(2 * 3).toBe(6);
  });
});
