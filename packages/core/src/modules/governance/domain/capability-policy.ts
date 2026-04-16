import type {
  GovernanceCapabilityBundle,
  GovernanceCapabilityDenySource,
  GovernanceCapabilityPolicySnapshot,
  GovernanceCapabilityResolutionSource,
  GovernanceLicenseTier
} from "./governance-decision.js";

const DEFAULT_SCOPE = "private" as const;

const normalizeCapabilityKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeBundleKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

const unique = (items: string[]): string[] => [...new Set(items.filter(Boolean))];

const toLowerOverride = (value?: string): "allow" | "deny" | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "allow") return "allow";
  if (normalized === "deny") return "deny";
  return undefined;
};

export const GOVERNANCE_CAPABILITY_DEFINITIONS = [
  {
    key: "conversation.direct",
    displayName: "Direct Conversation",
    description: "Normal direct-chat interactions.",
    category: "conversation"
  },
  {
    key: "conversation.group",
    displayName: "Group Conversation",
    description: "Normal group-chat interactions.",
    category: "conversation"
  },
  {
    key: "command.help",
    displayName: "Help Command",
    description: "Allow /help usage.",
    category: "command"
  },
  {
    key: "command.ping",
    displayName: "Ping Command",
    description: "Allow /ping usage.",
    category: "command"
  },
  {
    key: "command.status",
    displayName: "Status Command",
    description: "Allow /status usage.",
    category: "command"
  },
  {
    key: "command.hidetag",
    displayName: "Hidetag Command",
    description: "Allow /hidetag moderation action.",
    category: "moderation"
  },
  {
    key: "command.tts",
    displayName: "TTS Command",
    description: "Allow text-to-speech command.",
    category: "audio"
  },
  {
    key: "command.transcribe",
    displayName: "Transcribe Command",
    description: "Allow audio transcription command.",
    category: "audio"
  },
  {
    key: "command.search",
    displayName: "Search Command",
    description: "Allow basic web search command.",
    category: "search"
  },
  {
    key: "command.search_ai",
    displayName: "Search AI Command",
    description: "Allow AI-assisted search command.",
    category: "search"
  },
  {
    key: "command.img",
    displayName: "Image Search Command",
    description: "Allow image search commands.",
    category: "image"
  },
  {
    key: "command.download",
    displayName: "Download Command",
    description: "Allow media download command.",
    category: "download"
  },
  {
    key: "command.reminder",
    displayName: "Reminder Command",
    description: "Allow reminder and timer commands.",
    category: "productivity"
  }
] as const;

export const GOVERNANCE_BUNDLE_DEFINITIONS: GovernanceCapabilityBundle[] = [
  {
    key: "basic_chat",
    displayName: "Basic Chat",
    description: "Core chat and operational commands.",
    active: true,
    capabilities: [
      "conversation.direct",
      "conversation.group",
      "command.help",
      "command.ping",
      "command.status",
      "command.search"
    ]
  },
  {
    key: "search_tools",
    displayName: "Search Tools",
    description: "Advanced AI search capabilities.",
    active: true,
    capabilities: ["command.search_ai"]
  },
  {
    key: "audio_tools",
    displayName: "Audio Tools",
    description: "Speech synthesis and transcription tools.",
    active: true,
    capabilities: ["command.tts", "command.transcribe"]
  },
  {
    key: "image_tools",
    displayName: "Image Tools",
    description: "Image search and delivery tools.",
    active: true,
    capabilities: ["command.img"]
  },
  {
    key: "download_tools",
    displayName: "Download Tools",
    description: "Media download features.",
    active: true,
    capabilities: ["command.download"]
  },
  {
    key: "moderation_tools",
    displayName: "Moderation Tools",
    description: "Moderation capabilities such as hidetag.",
    active: true,
    capabilities: ["command.hidetag"]
  },
  {
    key: "productivity_tools",
    displayName: "Productivity Tools",
    description: "Reminder and scheduling helpers.",
    active: true,
    capabilities: ["command.reminder"]
  }
];

export const GOVERNANCE_TIER_DEFAULT_BUNDLES: Record<Exclude<GovernanceLicenseTier, "UNKNOWN">, string[]> = {
  FREE: ["basic_chat", "audio_tools", "image_tools", "productivity_tools"],
  BASIC: ["basic_chat", "audio_tools", "image_tools", "productivity_tools"],
  PRO: ["basic_chat", "audio_tools", "image_tools", "productivity_tools", "search_tools", "download_tools", "moderation_tools"],
  ROOT: ["basic_chat", "audio_tools", "image_tools", "productivity_tools", "search_tools", "download_tools", "moderation_tools"]
};

export const createDefaultCapabilityPolicySnapshot = (): GovernanceCapabilityPolicySnapshot => ({
  definitions: GOVERNANCE_CAPABILITY_DEFINITIONS.map((item) => ({
    key: item.key,
    displayName: item.displayName,
    description: item.description,
    category: item.category,
    active: true
  })),
  bundles: GOVERNANCE_BUNDLE_DEFINITIONS.map((bundle) => ({
    key: bundle.key,
    displayName: bundle.displayName,
    description: bundle.description,
    active: bundle.active,
    capabilities: unique(bundle.capabilities.map(normalizeCapabilityKey))
  })),
  tierDefaultBundles: {
    FREE: [...GOVERNANCE_TIER_DEFAULT_BUNDLES.FREE],
    BASIC: [...GOVERNANCE_TIER_DEFAULT_BUNDLES.BASIC],
    PRO: [...GOVERNANCE_TIER_DEFAULT_BUNDLES.PRO],
    ROOT: [...GOVERNANCE_TIER_DEFAULT_BUNDLES.ROOT]
  },
  assignments: {
    user: [],
    group: []
  },
  overrides: {
    user: {},
    group: {}
  }
});

type CapabilityScope = "private" | "group";

type ExplicitAllowSource = "user_override_allow" | "group_override_allow";

type ExplicitDenySource = "user_override_deny" | "group_override_deny";

export interface CapabilityEvaluationResult {
  capability: string;
  governed: boolean;
  tierDefaultAllowed: boolean;
  bundleAllowed: boolean;
  explicitAllowSource: ExplicitAllowSource | null;
  explicitDenySources: ExplicitDenySource[];
  effectiveBundleKeys: string[];
  matchedBundleKeys: string[];
  allow: boolean;
  decisionSource: GovernanceCapabilityResolutionSource;
  denySource: GovernanceCapabilityDenySource | null;
}

const buildBundleCapabilityIndex = (policy: GovernanceCapabilityPolicySnapshot): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  for (const bundle of policy.bundles) {
    const key = normalizeBundleKey(bundle.key);
    out.set(key, new Set(unique((bundle.capabilities ?? []).map(normalizeCapabilityKey))));
  }
  return out;
};

const resolveTierDefaultBundleKeys = (policy: GovernanceCapabilityPolicySnapshot, tier: GovernanceLicenseTier): string[] => {
  if (tier === "FREE") return policy.tierDefaultBundles.FREE.map(normalizeBundleKey);
  if (tier === "BASIC") return policy.tierDefaultBundles.BASIC.map(normalizeBundleKey);
  if (tier === "PRO") return policy.tierDefaultBundles.PRO.map(normalizeBundleKey);
  if (tier === "ROOT") return policy.tierDefaultBundles.ROOT.map(normalizeBundleKey);
  return [];
};

const resolveTierDefaultCapabilitySet = (input: {
  policy: GovernanceCapabilityPolicySnapshot;
  tier: GovernanceLicenseTier;
  bundleIndex: Map<string, Set<string>>;
}): Set<string> => {
  const out = new Set<string>();
  const bundleKeys = resolveTierDefaultBundleKeys(input.policy, input.tier);

  for (const bundleKey of bundleKeys) {
    const caps = input.bundleIndex.get(bundleKey);
    if (!caps) continue;
    for (const capability of caps) out.add(capability);
  }

  return out;
};

const resolveEffectiveBundleKeys = (input: {
  policy: GovernanceCapabilityPolicySnapshot;
  scope: CapabilityScope;
}): string[] => {
  const userBundles = (input.policy.assignments.user ?? []).map(normalizeBundleKey);
  if (input.scope !== "group") return unique(userBundles);
  const groupBundles = (input.policy.assignments.group ?? []).map(normalizeBundleKey);
  return unique([...groupBundles, ...userBundles]);
};

const pickExplicitAllow = (input: {
  scope: CapabilityScope;
  userOverride?: "allow" | "deny";
  groupOverride?: "allow" | "deny";
}): ExplicitAllowSource | null => {
  if (input.scope !== "group") {
    return input.userOverride === "allow" ? "user_override_allow" : null;
  }

  if (input.userOverride === "allow") return "user_override_allow";
  if (input.groupOverride === "allow") return "group_override_allow";
  return null;
};

const pickExplicitDenySources = (input: {
  scope: CapabilityScope;
  userOverride?: "allow" | "deny";
  groupOverride?: "allow" | "deny";
}): ExplicitDenySource[] => {
  const out: ExplicitDenySource[] = [];
  if (input.userOverride === "deny") out.push("user_override_deny");
  if (input.scope === "group" && input.groupOverride === "deny") out.push("group_override_deny");
  return out;
};

const resolveCapabilityDenySource = (input: {
  tierDefaultAllowed: boolean;
  bundleAllowed: boolean;
  explicitDenySources: ExplicitDenySource[];
  effectiveBundleKeys: string[];
}): GovernanceCapabilityDenySource | null => {
  if (input.explicitDenySources.length > 0) return "explicit_override_deny";
  if (input.tierDefaultAllowed || input.bundleAllowed) return null;
  if (input.effectiveBundleKeys.length > 0) return "missing_bundle";
  return "tier_default";
};

const isGovernedCapability = (policy: GovernanceCapabilityPolicySnapshot, capability: string): boolean => {
  const key = normalizeCapabilityKey(capability);
  return policy.definitions.some((item) => item.active !== false && normalizeCapabilityKey(item.key) === key);
};

export const evaluateCapabilityPolicy = (input: {
  policy: GovernanceCapabilityPolicySnapshot;
  capability: string;
  tier: GovernanceLicenseTier;
  scope?: CapabilityScope;
}): CapabilityEvaluationResult => {
  const scope = input.scope ?? DEFAULT_SCOPE;
  const capability = normalizeCapabilityKey(input.capability);
  const governed = isGovernedCapability(input.policy, capability);

  if (!governed) {
    return {
      capability,
      governed,
      tierDefaultAllowed: true,
      bundleAllowed: false,
      explicitAllowSource: null,
      explicitDenySources: [],
      effectiveBundleKeys: [],
      matchedBundleKeys: [],
      allow: true,
      decisionSource: "none",
      denySource: null
    };
  }

  const bundleIndex = buildBundleCapabilityIndex(input.policy);
  const tierDefaults = resolveTierDefaultCapabilitySet({
    policy: input.policy,
    tier: input.tier,
    bundleIndex
  });
  const tierDefaultAllowed = tierDefaults.has(capability);

  const effectiveBundleKeys = resolveEffectiveBundleKeys({
    policy: input.policy,
    scope
  });

  const matchedBundleKeys = unique(
    effectiveBundleKeys.filter((bundleKey) => {
      const capabilities = bundleIndex.get(bundleKey);
      return Boolean(capabilities?.has(capability));
    })
  );

  const bundleAllowed = matchedBundleKeys.length > 0;

  const userOverride = toLowerOverride(input.policy.overrides.user[capability]);
  const groupOverride = toLowerOverride(input.policy.overrides.group[capability]);

  const explicitAllowSource = pickExplicitAllow({
    scope,
    userOverride,
    groupOverride
  });
  const explicitDenySources = pickExplicitDenySources({
    scope,
    userOverride,
    groupOverride
  });

  const denySource = resolveCapabilityDenySource({
    tierDefaultAllowed,
    bundleAllowed,
    explicitDenySources,
    effectiveBundleKeys
  });

  const allow = explicitDenySources.length === 0 && (Boolean(explicitAllowSource) || tierDefaultAllowed || bundleAllowed);

  let decisionSource: GovernanceCapabilityResolutionSource = "none";
  if (explicitAllowSource === "user_override_allow") decisionSource = "user_override_allow";
  else if (explicitAllowSource === "group_override_allow") decisionSource = "group_override_allow";
  else if (bundleAllowed) decisionSource = "bundle";
  else if (tierDefaultAllowed) decisionSource = "tier_default";

  return {
    capability,
    governed,
    tierDefaultAllowed,
    bundleAllowed,
    explicitAllowSource,
    explicitDenySources,
    effectiveBundleKeys,
    matchedBundleKeys,
    allow,
    decisionSource,
    denySource
  };
};

export interface EffectiveCapabilityView {
  key: string;
  allow: boolean;
  source: GovernanceCapabilityResolutionSource;
  denySource: GovernanceCapabilityDenySource | null;
  tierDefaultAllowed: boolean;
  bundleAllowed: boolean;
  matchedBundles: string[];
  explicitAllowSource: ExplicitAllowSource | null;
  explicitDenySources: ExplicitDenySource[];
}

export const listEffectiveCapabilities = (input: {
  policy: GovernanceCapabilityPolicySnapshot;
  tier: GovernanceLicenseTier;
  scope?: CapabilityScope;
}): EffectiveCapabilityView[] => {
  const definitions = input.policy.definitions.filter((item) => item.active !== false);
  return definitions
    .map((definition) => {
      const evaluated = evaluateCapabilityPolicy({
        policy: input.policy,
        capability: definition.key,
        tier: input.tier,
        scope: input.scope
      });

      return {
        key: evaluated.capability,
        allow: evaluated.allow,
        source: evaluated.decisionSource,
        denySource: evaluated.denySource,
        tierDefaultAllowed: evaluated.tierDefaultAllowed,
        bundleAllowed: evaluated.bundleAllowed,
        matchedBundles: evaluated.matchedBundleKeys,
        explicitAllowSource: evaluated.explicitAllowSource,
        explicitDenySources: evaluated.explicitDenySources
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
};

export const normalizeGovernanceCapabilityKey = normalizeCapabilityKey;
export const normalizeGovernanceBundleKey = normalizeBundleKey;
