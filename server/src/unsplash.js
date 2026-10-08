const cache = new Map();


function credited(url) {
  const next = new URL(url);
  next.searchParams.set("utm_source", "taste_desk");
  next.searchParams.set("utm_medium", "referral");
  return next.toString();
}

export function publicPhoto(photo, city) {
  const imageUrl = photo?.urls?.regular || photo?.urls?.small || "";
  if (!imageUrl) return null;
  const photographer = photo.user?.name || "Unsplash photographer";
  const photographerUrl = photo.user?.links?.html || "https://unsplash.com";
  const photoUrl = photo.links?.html || "https://unsplash.com";
  return {
    imageUrl,
    alt: photo.alt_description || photo.description || `A photograph related to ${city}`,
    photographer,
    photographerUrl: credited(photographerUrl),
    photoUrl: credited(photoUrl),
    unsplashUrl: credited("https://unsplash.com"),
  };
}

export async function cityPhoto(city, env = process.env, fetchImpl = fetch) {
  const query = String(city || "").trim().replace(/\s+/g, " ");
  if (query.length < 2 || query.length > 80) return null;
  const key = query.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const accessKey = typeof env.UNSPLASH_ACCESS_KEY === "string" ? env.UNSPLASH_ACCESS_KEY.trim() : "";
  if (!accessKey) return null;
  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", `${query} city`);
  url.searchParams.set("per_page", "1");
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("content_filter", "high");
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
      "Accept-Version": "v1",
    },
  });
  if (!response.ok) return null;
  const body = await response.json();
  const photo = Array.isArray(body.results) ? body.results[0] : null;
  const result = photo ? publicPhoto(photo, query) : null;
  if (result && photo.links?.download_location) {
    fetchImpl(photo.links.download_location, {
      headers: { Authorization: `Client-ID ${accessKey}` },
    }).catch(() => {});
  }
  cache.set(key, result);
  return result;
}
