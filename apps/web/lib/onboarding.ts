import type { InsightType, ProfileEntry } from "@focal-ai/core";

export interface TryLink {
  label: string;
  url: string;
}

/** Public list pages worth trying the extension on, per entity type. */
const LINK_BUILDERS: Record<string, (city: string | null) => TryLink> = {
  "urn:entity:place": (city) => ({
    label: city ? `Restaurants on Yelp in ${city}` : "Restaurants on Yelp",
    url: city
      ? `https://www.yelp.com/search?find_desc=restaurants&find_loc=${encodeURIComponent(city)}`
      : "https://www.yelp.com/search?find_desc=restaurants",
  }),
  "urn:entity:destination": (city) => ({
    label: city ? `Things to do in ${city} on Yelp` : "Travelers' Choice on Tripadvisor",
    url: city
      ? `https://www.yelp.com/search?find_desc=things+to+do&find_loc=${encodeURIComponent(city)}`
      : "https://www.tripadvisor.com/TravelersChoice-Destinations",
  }),
  "urn:entity:movie": () => ({ label: "Popular films on Letterboxd", url: "https://letterboxd.com/films/popular/" }),
  "urn:entity:tv_show": () => ({ label: "Top shows on IMDb", url: "https://www.imdb.com/chart/toptv/" }),
  "urn:entity:book": () => ({ label: "Best books on Goodreads", url: "https://www.goodreads.com/list/show/1.Best_Books_Ever" }),
  "urn:entity:podcast": () => ({ label: "Top podcasts on Apple", url: "https://podcasts.apple.com/us/charts" }),
  "urn:entity:artist": () => ({ label: "Top artists on Last.fm", url: "https://www.last.fm/charts" }),
  "urn:entity:videogame": () => ({ label: "Top games on Metacritic", url: "https://www.metacritic.com/browse/games/score/metascore/all/all/" }),
};

const hasBuilder = (type: string): type is InsightType => type in LINK_BUILDERS;

/** First plausible city: the name of a liked destination (places are restaurants, not cities). */
function cityOf(entries: ProfileEntry[]): string | null {
  const place = entries.find((e) => e.kind === "thing" && e.strength !== "dislike" && e.type === "urn:entity:destination");
  return place?.name ?? null;
}

/** "Try it now" links built from the profile's entity types and city (§2). */
export function tryNowLinks(entries: ProfileEntry[]): TryLink[] {
  const city = cityOf(entries);
  const seen = new Set<string>();
  const links: TryLink[] = [];
  for (const entry of entries) {
    if (entry.kind !== "thing" || !hasBuilder(entry.type) || seen.has(entry.type)) continue;
    seen.add(entry.type);
    links.push(LINK_BUILDERS[entry.type]!(entry.type === "urn:entity:place" || entry.type === "urn:entity:destination" ? city : null));
  }
  if (links.length === 0) links.push({ label: "Top movies on IMDb", url: "https://www.imdb.com/chart/top/" });
  return links;
}
