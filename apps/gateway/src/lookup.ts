import type { GatewayConfig } from "./config";
import { abortSignal } from "./errors";
import { isObject, isText } from "./media";
export async function lookup(
  query: string,
  config: GatewayConfig,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const search = {
    title: `Search the web for ${query}`,
    url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    excerpt: "Search link; verify facts on the source page before acting.",
  };
  if (config.demo)
    return { results: [search], provider: "demo", source: "Labeled local search-link fixture" };
  try {
    const response = await fetcher(
      `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=4&search=${encodeURIComponent(query)}`,
      {
        signal: abortSignal(signal, 6000),
        headers: { "user-agent": "HypeMan/1.0 local browser companion" },
      },
    );
    if (response.ok) {
      const raw: unknown = await response.json();
      if (Array.isArray(raw) && Array.isArray(raw[1]) && Array.isArray(raw[3]))
        return {
          results: [
            ...raw[1]
              .slice(0, 4)
              .filter((title) => isText(title, 1000))
              .map((title, index) => ({
                title,
                url: raw[3][index],
                excerpt: isText(raw[2]?.[index], 2000) ? raw[2][index] : "",
              })),
            search,
          ],
          provider: "local",
        };
    }
  } catch {
    signal.throwIfAborted();
  }
  return { results: [search], provider: "local" };
}
