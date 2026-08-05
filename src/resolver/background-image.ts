export function extractBackgroundImageUrls(value: string): string[] {
  const urls: string[] = [];
  const expression = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/giu;
  for (const match of value.matchAll(expression)) {
    const url = match[1] ?? match[2] ?? match[3]?.trim();
    if (url) urls.push(url);
  }
  return urls;
}
