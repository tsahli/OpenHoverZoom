import { mayFetchLinkedPage } from "./dom-resolver";
import { closestAcrossShadow, walkBoundedDescendants } from "../shared/dom";

const TEXT_LINK_MEDIA_WALK = { maxDepth: 4, maxElements: 32 } as const;
// Links in page chrome lead to sections of the site, and their pages describe the site.
const PAGE_CHROME_SELECTOR =
  "nav,header,footer,[role='navigation'],[role='menu'],[role='menubar']";
const MEDIA_SELECTOR = "img,picture,video,audio,svg,canvas";

/**
 * Whether a plain link may have its page looked up for a picture. It must lead
 * somewhere new, sit in page content, and carry no media of its own, since a link
 * around media is previewed through that media instead.
 */
export function isEligibleTextLink(anchor: HTMLAnchorElement): boolean {
  if (anchor.protocol !== "http:" && anchor.protocol !== "https:") return false;
  if (anchor.hasAttribute("download") || !mayFetchLinkedPage(anchor)) return false;
  // A same-page anchor, or a link back to this very page, has nothing new to show.
  if (withoutFragment(anchor.href) === withoutFragment(anchor.ownerDocument.location.href)) {
    return false;
  }
  if (closestAcrossShadow(anchor, PAGE_CHROME_SELECTOR)) return false;
  for (const element of walkBoundedDescendants(anchor, TEXT_LINK_MEDIA_WALK)) {
    if (element.matches(MEDIA_SELECTOR)) return false;
  }
  return true;
}

function withoutFragment(value: string): string {
  const index = value.indexOf("#");
  return index < 0 ? value : value.slice(0, index);
}
