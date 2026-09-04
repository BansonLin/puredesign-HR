import { describe, expect, it } from "vitest";

describe("toolchain smoke", () => {
  it("runs vitest in a node environment", () => {
    expect(typeof process.version).toBe("string");
    expect(typeof window).toBe("undefined");
  });
});
