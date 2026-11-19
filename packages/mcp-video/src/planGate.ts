/**
 * planGate.ts — the Keeper-and-up plan gate for video tool execution.
 *
 * This is a faithful mirror of the FinchLearn MCP server's gate
 * (packages/mcp-server/src/lib/planGate.ts in jpsnow72/open-course-format,
 * Justin's 2026-11-12 decision): MCP access is a paid-plan feature,
 * Keeper ($99/yr) and every plan above it (Creator, Studio,
 * Enterprise); the free Community plan is excluded.
 *
 * Semantics carried over exactly, do not drift:
 * - ENFORCEMENT POINT: tool EXECUTION only. Connecting, initialize,
 *   tools/list, resources, prompts, and the capabilities surface stay
 *   open to any signed-in user, and the capabilities payload
 *   self-describes this requirement (see videoPlanAccessSummary).
 * - PLAN SOURCE: the product's own resolver, effective_plan_level(),
 *   reached through @ocf/cloud's getEffectivePlanLevel on the MCP
 *   server side. This package never re-implements plan resolution:
 *   the caller injects a resolver (ports.ts, PlanResolver) and the
 *   MCP-server wiring passes the same wrapper the course tools use.
 * - FAIL CLOSED: a resolver result of null (RPC missing, offline,
 *   odd payload, resolver threw) never unlocks a tool. The caller
 *   gets the "could not confirm" wording, not a claim about their plan.
 * - CACHING: an ALLOWING resolution is cached per user for 60
 *   seconds. A DENYING resolution is never cached, so an upgrade
 *   unlocks on the very next tool call. The accepted lag runs the
 *   other way: a downgrade can take up to the TTL to bite.
 * - Reads and writes are both gated; there is no read carve-out.
 */

export type PlanLevel = "community" | "keeper" | "creator" | "studio" | "enterprise";

/** One ranking for every plan decision (mirrors @ocf/cloud PLAN_RANK). */
export const PLAN_RANK: Record<PlanLevel, number> = {
  community: 0,
  keeper: 1,
  creator: 2,
  studio: 3,
  enterprise: 4,
};

export function planRank(plan: PlanLevel | null | undefined): number {
  return plan ? PLAN_RANK[plan] : -1;
}

export function planDisplayName(plan: PlanLevel): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/** The lowest plan that unlocks the tools (Justin's decision). */
export const MCP_MINIMUM_PLAN: PlanLevel = "keeper";

/**
 * The one exempt tool: the capabilities surface that explains the
 * gate. Every video tool is gated; get_capabilities itself lives on
 * the MCP server and stays exempt there, exactly as today.
 */
export const PLAN_GATE_EXEMPT_TOOLS: ReadonlySet<string> = new Set(["get_capabilities"]);

const ALLOW_CACHE_TTL_MS = 60_000;

export interface PlanGateDeps {
  /**
   * Resolves the caller's effective plan, or null when it cannot be
   * confirmed. On the MCP server this is
   * (ctx) => getEffectivePlanLevel(ctx.client, ctx.userId).
   */
  resolvePlan: (userId: string) => Promise<PlanLevel | null>;
  /** Clock override for tests. */
  now?: () => number;
}

export class PlanGate {
  private readonly allowCache = new Map<string, { plan: PlanLevel; at: number }>();

  constructor(private readonly deps: PlanGateDeps) {}

  /** Test hook, mirroring the server gate's __clearPlanCache. */
  clearCache(): void {
    this.allowCache.clear();
  }

  /**
   * The caller's effective plan from the injected resolver, or null
   * when the plan cannot be confirmed (fail-closed input). A
   * throwing resolver is treated exactly like a null resolution.
   */
  async resolveCallerPlan(userId: string): Promise<PlanLevel | null> {
    const now = this.deps.now ?? Date.now;
    const hit = this.allowCache.get(userId);
    if (hit && now() - hit.at < ALLOW_CACHE_TTL_MS) return hit.plan;
    let plan: PlanLevel | null;
    try {
      plan = await this.deps.resolvePlan(userId);
    } catch {
      plan = null;
    }
    if (plan !== null && planAllowsMcp(plan)) {
      this.allowCache.set(userId, { plan, at: now() });
    }
    return plan;
  }

  /** The dispatch-path check: exempt tools never reach this. */
  async check(userId: string, toolName: string): Promise<PlanGateVerdict> {
    const plan = await this.resolveCallerPlan(userId);
    if (planAllowsMcp(plan)) return { allowed: true, plan };
    return { allowed: false, plan, message: planRequiredMessage(toolName, plan) };
  }

  /**
   * The caller-specific plan block the capabilities payload carries,
   * so a connecting AI can explain the gate before trying a tool.
   * Wording mirrors the server gate's planAccessSummary.
   */
  async accessSummary(userId: string): Promise<Record<string, unknown>> {
    const plan = await this.resolveCallerPlan(userId);
    const allowed = planAllowsMcp(plan);
    return {
      requirement:
        "Using the tools (other than get_capabilities itself) requires the account to be on " +
        "Keeper ($99/yr) or a higher paid plan (Creator, Studio, Enterprise). The free " +
        "Community plan can connect, list the tools, read the resources, and read this " +
        "catalog; its other tool calls return a plan_required error with upgrade instructions. " +
        "The video tools follow this same rule, with no separate video plan.",
      caller_plan: plan,
      caller_plan_confirmed: plan !== null,
      tools_unlocked: allowed,
      note: allowed
        ? `This account is on the ${planDisplayName(plan as PlanLevel)} plan, which includes the AI tools.`
        : plan === null
          ? "We could not confirm this account's plan just now, so tool calls are paused " +
            "until the plan can be confirmed (access fails closed). If the account is on " +
            "Keeper or higher, the tools unlock as soon as the plan confirms."
          : `This account is on the ${planDisplayName(plan)} plan. Other tool calls return a ` +
            "plan_required error until the account upgrades to Keeper or higher in " +
            "FinchLearn (Profile, then Billing).",
    };
  }
}

/** Keeper-and-up, in the product's own ranking. Null never allows. */
export function planAllowsMcp(plan: PlanLevel | null): boolean {
  return plan !== null && planRank(plan) >= planRank(MCP_MINIMUM_PLAN);
}

const REQUIREMENT =
  "FinchLearn's AI tools (this MCP server) are a paid-plan feature: they are included " +
  "with Keeper ($99/yr) and every plan above it (Creator, Studio, and Enterprise).";

/**
 * The upgrade error text, verbatim the server gate's wording. Plain
 * words, no em dashes, and it names the in-app upgrade path.
 */
export function planRequiredMessage(toolName: string, plan: PlanLevel | null): string {
  if (plan === null) {
    return (
      `${REQUIREMENT} We could not confirm this account's plan just now, so the tool ` +
      `"${toolName}" is paused. If this account is already on Keeper or a higher plan, ` +
      `wait a moment and try again. Otherwise, open FinchLearn, go to Profile, then ` +
      `Billing, and upgrade to Keeper to unlock the tools. This connection stays set ` +
      `up either way.`
    );
  }
  return (
    `${REQUIREMENT} This account is on the ${planDisplayName(plan)} plan, so the tool ` +
    `"${toolName}" cannot run yet. To unlock it, open FinchLearn, go to Profile, then ` +
    `Billing, and upgrade to Keeper. This connection stays set up: every tool starts ` +
    `working as soon as the upgrade lands.`
  );
}

export interface PlanGateVerdict {
  allowed: boolean;
  /** The resolved plan, or null when it could not be confirmed. */
  plan: PlanLevel | null;
  /** The upgrade error text when allowed is false. */
  message?: string;
}
