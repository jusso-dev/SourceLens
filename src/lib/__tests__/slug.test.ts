import { describe, expect, it } from "vitest";
import { slugify } from "../slug";

describe("slugify", () => {
  it("lowercases and dashes spaces", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });
  it("strips non-alphanumerics", () => {
    expect(slugify("Justin's Workspace!!")).toBe("justin-s-workspace");
  });
  it("collapses repeated separators", () => {
    expect(slugify("a  --b__c")).toBe("a-b-c");
  });
  it("returns 'workspace' for blank-after-strip", () => {
    expect(slugify("!!!")).toBe("workspace");
    expect(slugify("")).toBe("workspace");
  });
  it("caps length at 48", () => {
    const s = slugify("x".repeat(120));
    expect(s.length).toBeLessThanOrEqual(48);
  });
});
