import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

function FitClusters({ clusters }) {
  const map = useMap();
  useEffect(() => {
    const spots = clusters.map((cluster) => [cluster.latitude, cluster.longitude]);
    if (spots.length === 1) {
      map.setView(spots[0], 6);
      return;
    }
    map.fitBounds(spots, { padding: [36, 36] });
  }, [map, clusters]);
  return null;
}

function radiusFor(cluster, clusters) {
  const max = Math.max(...clusters.map((item) => item.weight || 0), 1);
  return 12 + ((cluster.weight || 0) / max) * 18;
}

export function TasteMap({ tasteMap }) {
  const clusters = Array.isArray(tasteMap?.clusters) ? tasteMap.clusters : [];
  if (clusters.length === 0) return null;

  return (
    <section className="taste-map-panel" aria-label="Taste map">
      <div className="taste-map-copy">
        <h2>Taste map</h2>
        <p className="taste-summary">{tasteMap.summary}</p>
        <p className="taste-caption">
          These areas are an aggregate pattern for the resolved tastes in {tasteMap.country}. They are not a claim about any one person.
        </p>
      </div>
      <MapContainer
        className="taste-map"
        center={[clusters[0].latitude, clusters[0].longitude]}
        zoom={5}
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
            key={`${cluster.latitude}-${cluster.longitude}`}
            center={[cluster.latitude, cluster.longitude]}
            radius={radiusFor(cluster, clusters)}
            pathOptions={{ color: "#9c4a2b", fillColor: "#c4623a", fillOpacity: 0.55, weight: 2 }}
          >
            <Popup>
              <strong>{cluster.label || "Aggregate area"}</strong>
              <br />
              Aggregate affinity {cluster.weight}
              <br />
              Tastes in this pattern: {(cluster.sources || []).join(", ") || "resolved favorites"}
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
