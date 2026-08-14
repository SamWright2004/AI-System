export const toolRiskLevels = [
  "read",
  "draft",
  "write_reversible",
  "external_commit",
  "destructive",
] as const;

export type ToolRisk = (typeof toolRiskLevels)[number];

export interface ToolPolicyContext {
  isBackgroundRun: boolean;
  hasScopedGrant: boolean;
}

export interface ToolPolicyDecision {
  outcome: "allow" | "require_approval" | "deny";
  reason: string;
}

/**
 * The model never decides its own authority. This deterministic policy sits between
 * every proposed tool call and the outside world.
 */
export function evaluateToolRisk(risk: ToolRisk, context: ToolPolicyContext): ToolPolicyDecision {
  if (risk === "read" || risk === "draft") {
    return {
      outcome: "allow",
      reason: "This action observes data or creates an internal draft only.",
    };
  }

  if (risk === "write_reversible" && context.hasScopedGrant) {
    return {
      outcome: "allow",
      reason: "A current, narrowly scoped permission covers this reversible change.",
    };
  }

  if (risk === "destructive" && context.isBackgroundRun) {
    return {
      outcome: "deny",
      reason: "Destructive actions cannot be performed by an unattended run.",
    };
  }

  return {
    outcome: "require_approval",
    reason: "This action changes external state and needs an explicit decision.",
  };
}
