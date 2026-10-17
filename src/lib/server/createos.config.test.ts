import { describe, it, expect } from "vitest";
import { SANDBOX_EGRESS, SANDBOX_SHAPE, SANDBOX_ROOTFS } from "./createos.server";

describe("createos sandbox config", () => {
  it("never uses open egress (empty or *)", () => {
    expect(SANDBOX_EGRESS.length).toBeGreaterThan(0);
    expect(SANDBOX_EGRESS).not.toContain("*");
  });
  it("uses the required shape and rootfs", () => {
    expect(SANDBOX_SHAPE).toBe("s-1vcpu-1gb");
    expect(SANDBOX_ROOTFS).toBe("devbox:1");
  });
});