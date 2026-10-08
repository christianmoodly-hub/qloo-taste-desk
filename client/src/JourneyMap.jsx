import { useEffect, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

function placeQuery(item, city) {
  if (city) return `${item.name}, ${city}`;
  return [item.name, item.address].filter(Boolean).join(", ");
}

function pinIcon(number) {
  return L.divIcon({
    className: "map-pin",
    html: `<span>${number}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function distanceKm(from, to) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const lat = toRad(to.lat - from.lat);
  const lng = toRad(to.lng - from.lng);
  const a = Math.sin(lat / 2) ** 2
    + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(lng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestKm(user, points) {
  return Math.min(...points.map((point) => distanceKm(user, point)));
}

function FitStops({ points, user }) {
  const map = useMap();
  useEffect(() => {
    const spots = points.map((point) => [point.lat, point.lng]);
    const includeUser = user && nearestKm(user, points) <= 120;
    if (includeUser) spots.push([user.lat, user.lng]);
    if (spots.length === 1) {
      map.setView(spots[0], 14);
      return;
    }
    map.fitBounds(spots, { padding: [28, 28] });
  }, [map, points, user]);
  return null;
}

function readLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 },
    );
  });
}

function youIcon() {
  return L.divIcon({
    className: "map-pin you",
    html: "<span></span>",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export function JourneyMap({ items, city }) {
  const [points, setPoints] = useState(null);
  const [userPoint, setUserPoint] = useState(undefined);
  const [locateTick, setLocateTick] = useState(0);
  const queries = (items || []).map((item) => placeQuery(item, city));
  const queryKey = queries.join("|");

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    async function load() {
      try {
        const response = await fetch("/api/geocode", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ queries }),
        });
        const body = await response.json();
        if (cancelled) return;
        const placed = (body.points || [])
          .map((point, index) => (point ? { ...point, name: items[index]?.name, number: index + 1 } : null))
          .filter(Boolean);
        setPoints(placed);
      } catch {
        if (!cancelled) setPoints([]);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [queryKey]);

  useEffect(() => {
    let cancelled = false;
    setUserPoint(undefined);
    readLocation().then((point) => {
      if (!cancelled) setUserPoint(point);
    });
    return () => {
      cancelled = true;
    };
  }, [locateTick]);

  if (!points) return <p className="map-status">Placing the stops on the map.</p>;
  if (points.length === 0) return <p className="map-status">These addresses could not be placed on a map.</p>;

  const away = userPoint ? Math.round(nearestKm(userPoint, points)) : null;
  const showUser = userPoint && away <= 120;
  let note = "The pins follow this plan.";
  if (userPoint === undefined) note = "Asking this browser for your location.";
  else if (!userPoint) note = "This browser did not share a location. The pins are still the planned stops.";
  else if (showUser) note = "Your location is on the map with these stops.";
  else note = `You are about ${away} km from the nearest stop.`;

  return (
    <div className="map-stack">
      <MapContainer
        className="plan-map"
        center={[points[0].lat, points[0].lng]}
        zoom={12}
        scrollWheelZoom={false}
        attributionControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitStops points={points} user={showUser ? userPoint : null} />
        {points.map((point) => (
          <Marker key={`${point.number}-${point.name}`} position={[point.lat, point.lng]} icon={pinIcon(point.number)} />
        ))}
        {showUser ? (
          <Marker title="You" position={[userPoint.lat, userPoint.lng]} icon={youIcon()} />
        ) : null}
      </MapContainer>
      <p className="map-note">{note}</p>
      <button type="button" className="text-link map-locate" onClick={() => setLocateTick((tick) => tick + 1)}>
        Use my location
      </button>
    </div>
  );
}
