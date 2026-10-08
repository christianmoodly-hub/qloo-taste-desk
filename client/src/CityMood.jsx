import { useEffect, useState } from "react";

export function CityMood({ city }) {
  const [photo, setPhoto] = useState(null);
  const place = city.trim();

  useEffect(() => {
    if (place.length < 2) {
      setPhoto(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/mood?city=${encodeURIComponent(place)}`)
        .then((response) => response.json())
        .then((body) => {
          if (!cancelled) setPhoto(body.photo || null);
        })
        .catch(() => {
          if (!cancelled) setPhoto(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [place]);

  if (!photo) return null;

  return (
    <figure className="city-mood">
      <img src={photo.imageUrl} alt={photo.alt} />
      <figcaption>
        Related photograph of {place} by{" "}
        <a href={photo.photographerUrl} target="_blank" rel="noreferrer">{photo.photographer}</a>
        {" "}on{" "}
        <a href={photo.unsplashUrl} target="_blank" rel="noreferrer">Unsplash</a>
      </figcaption>
    </figure>
  );
}
