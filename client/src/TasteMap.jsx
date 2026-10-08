import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

function FitClusters({ clusters }) {
  const map = useMap();
  useEffect(() => {
    const spots = clusters.map((cluster) => [cluster.latitude, cluster.longitude]);
    if (spots.length === 1) {
      map.setView(spots[0], 13);
      return;
    }
    map.fitBounds(spots, { padding: [36, 36], maxZoom: 14 });
  }, [map, clusters]);
  return null;
}

function radiusFor(cluster, clusters) {
  const max = Math.max(...clusters.map((item) => item.weight || 0), 1);
  return 10 + ((cluster.weight || 0) / max) * 16;
}

export function TasteMap({ tasteMap }) {
  const favorites = Array.isArray(tasteMap?.favorites) ? tasteMap.favorites : [];
  const clusters = favorites.flatMap((favorite) => (
    (favorite.clusters || []).map((cluster) => ({ ...cluster, favorite: favorite.name, color: favorite.color }))
  ));
  if (clusters.length === 0) return null;

  return (
    <section className="taste-map-panel" aria-label="Taste map">
      <div className="taste-map-copy">
        <h2>Taste map</h2>
        <p className="taste-summary">{tasteMap.summary}</p>
        <p className="taste-caption">
          These areas show where fans of these tastes concentrate in {tasteMap.city}. The pattern is aggregate, not a claim about you.
        </p>
        <ul className="taste-legend">
          {favorites.map((favorite) => (
            <li key={favorite.name}>
              <span className="swatch" style={{ background: favorite.color }} />
              {favorite.name}
            </li>
          ))}
        </ul>
      </div>
      <MapContainer
        className="taste-map"
        center={[clusters[0].latitude, clusters[0].longitude]}
        zoom={12}
        scrollWheelZoom={false}
        attributionControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitClusters clusters={clusters} />
        {clusters.map((cluster) => (
          <CircleMarker
            key={`${cluster.favorite}-${cluster.latitude}-${cluster.longitude}`}
            center={[cluster.latitude, cluster.longitude]}
            radius={radiusFor(cluster, clusters)}
            pathOptions={{ color: cluster.color, fillColor: cluster.color, fillOpacity: 0.45, weight: 2 }}
          >
            <Popup>
              <strong>{cluster.label}</strong>
              <br />
              {cluster.favorite} fans
              <br />
              Aggregate affinity {cluster.weight}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      <p className="map-note">
        Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors
      </p>
    </section>
  );
}

export function TasteTags({ tasteTags }) {
  const favorites = Array.isArray(tasteTags?.favorites) ? tasteTags.favorites : [];
  if (favorites.length === 0) return null;
  return (
    <section className="taste-tags-panel" aria-label="Your taste, in tags">
      <h2>Your taste, in tags</h2>
      {favorites.map((favorite) => (
        <div key={favorite.name} className="taste-tag-group">
          <h3>{favorite.name}</h3>
          <ul>
            {favorite.tags.map((tag) => (
              <li key={`${favorite.name}-${tag.type}-${tag.name}`}>{tag.name}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
