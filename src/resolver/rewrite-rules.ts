import type { MediaCandidate } from "./candidate";
import { hostMatches, normalizeUrl } from "./url";

export interface RewriteRule {
  id: string;
  appliesTo: "image" | "link" | "both";
  pageHosts?: readonly string[];
  mediaHosts?: readonly string[];
  match: RegExp;
  replace: string;
  priority?: number;
}

export interface RewriteContext {
  pageUrl: string;
  target: "image" | "link";
}

// Rules are deliberately empty until a transformation is justified by a real,
// independently documented compatibility case and fixture test.
export const REWRITE_RULES: readonly RewriteRule[] = [];

export function applyRewriteRules(
  candidate: MediaCandidate,
  context: RewriteContext,
  rules: readonly RewriteRule[] = REWRITE_RULES,
): MediaCandidate[] {
  let page: URL;
  let media: URL;
  try {
    page = new URL(context.pageUrl);
    media = new URL(candidate.url);
  } catch {
    return [];
  }

  return rules
    .filter((rule) => rule.appliesTo === "both" || rule.appliesTo === context.target)
    .filter((rule) => !rule.pageHosts || hostMatches(page.hostname, rule.pageHosts))
    .filter((rule) => !rule.mediaHosts || hostMatches(media.hostname, rule.mediaHosts))
    .filter((rule) => !rule.match.global && !rule.match.sticky)
    .filter((rule) => rule.match.test(candidate.url))
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
    .flatMap((rule) => {
      const replaced = candidate.url.replace(rule.match, rule.replace);
      const normalized = normalizeUrl(replaced, candidate.url);
      if (!normalized || normalized === candidate.url) return [];
      return [
        {
          ...candidate,
          url: normalized,
          source: "rewrite-rule" as const,
          confidence: Math.min(100, candidate.confidence + (rule.priority ?? 5)),
        },
      ];
    });
}
