import { describe, expect, it } from "vitest";
import { compareRoles, roleAtLeast } from "../rbac";

describe("rbac.roleAtLeast", () => {
  it("owner is the highest rank", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("owner", "member")).toBe(true);
    expect(roleAtLeast("owner", "viewer")).toBe(true);
    expect(roleAtLeast("owner", "owner")).toBe(true);
  });

  it("admin is below owner but above member", () => {
    expect(roleAtLeast("admin", "owner")).toBe(false);
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("admin", "member")).toBe(true);
  });

  it("viewer is the lowest rank", () => {
    expect(roleAtLeast("viewer", "member")).toBe(false);
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
  });
});

describe("rbac.compareRoles", () => {
  it("returns negative when a is lower", () => {
    expect(compareRoles("viewer", "owner")).toBeLessThan(0);
  });
  it("returns positive when a is higher", () => {
    expect(compareRoles("admin", "member")).toBeGreaterThan(0);
  });
  it("returns 0 when equal", () => {
    expect(compareRoles("member", "member")).toBe(0);
  });
});
