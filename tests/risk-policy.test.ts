import { describe, expect, it } from "vitest";
import { evaluateToolRisk } from "../src/core/tools/risk-policy.js";

describe("tool risk policy", () => {
  it("allows reads without interrupting the user", () => {
    expect(evaluateToolRisk("read", { isBackgroundRun: true, hasScopedGrant: false }).outcome).toBe(
      "allow",
    );
  });

  it("allows internal drafts without claiming an external action", () => {
    expect(
      evaluateToolRisk("draft", { isBackgroundRun: true, hasScopedGrant: false }).outcome,
    ).toBe("allow");
  });

  it("requires approval for external commitments", () => {
    expect(
      evaluateToolRisk("external_commit", { isBackgroundRun: false, hasScopedGrant: true }).outcome,
    ).toBe("require_approval");
  });

  it("denies unattended destructive work", () => {
    expect(
      evaluateToolRisk("destructive", { isBackgroundRun: true, hasScopedGrant: true }).outcome,
    ).toBe("deny");
  });
});
