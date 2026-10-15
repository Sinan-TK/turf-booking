'use client';

import { useCallback, useEffect, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Leaflet's default marker icon references image files by relative URL,
// which breaks once bundled by webpack/Next (the URLs resolve to
// nothing) — the standard fix is to drop the broken default and point
// it at CDN-hosted copies of the same images instead. Must run once,
// at module load, before any <Marker> renders.
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Kerala — this deployment's current launch region (matches
// packages/database/prisma/seed.ts) — never 0,0 (open ocean), which is
// what an unset lat/lng would otherwise center the map on.
const DEFAULT_CENTER: [number, number] = [10.8505, 76.2711];
const DEFAULT_ZOOM = 7;
const PICKED_ZOOM = 15;

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** MapContainer's `center` prop only applies at mount (react-leaflet's
 * own design — it's not meant to fight a user panning the map). "Use my
 * current location" needs the view to actually move there, though, so
 * this imperatively pans the map whenever `target` changes — only
 * rendered/keyed from that one flow, never from a plain click or drag,
 * where the user is already looking at the point they picked. */
function RecenterOnLocate({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.setView(target, PICKED_ZOOM);
  }, [target, map]);
  return null;
}

export default function MapLocationPicker({
  lat,
  lng,
  onChange,
}: {
  lat: string;
  lng: string;
  onChange: (lat: string, lng: string) => void;
}) {
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  const hasPosition = lat !== '' && lng !== '' && !Number.isNaN(parsedLat) && !Number.isNaN(parsedLng);

  // react-leaflet's <MapContainer center> only sets the *initial* view —
  // it's not reactive to prop changes after mount (deliberately, per its
  // own docs), so this only needs to be right once, on first render; no
  // memoization or effect needed to keep it in sync afterward.
  const center: [number, number] = hasPosition ? [parsedLat, parsedLng] : DEFAULT_CENTER;

  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [locateTarget, setLocateTarget] = useState<[number, number] | null>(null);

  const pick = useCallback(
    (newLat: number, newLng: number) => {
      onChange(newLat.toFixed(6), newLng.toFixed(6));
    },
    [onChange],
  );

  function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setLocateError('Location is not available in this browser.');
      return;
    }
    setLocateError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        pick(latitude, longitude);
        setLocateTarget([latitude, longitude]);
        setLocating(false);
      },
      () => {
        setLocateError('Could not get your location — check browser permissions.');
        setLocating(false);
      },
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-md border border-gray-300" style={{ height: 280 }}>
        <MapContainer center={center} zoom={hasPosition ? PICKED_ZOOM : DEFAULT_ZOOM} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onPick={pick} />
          <RecenterOnLocate target={locateTarget} />
          {hasPosition && (
            <Marker
              position={[parsedLat, parsedLng]}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target as L.Marker;
                  const pos = marker.getLatLng();
                  pick(pos.lat, pos.lng);
                },
              }}
            />
          )}
        </MapContainer>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={handleUseCurrentLocation}
          disabled={locating}
          className="text-xs font-medium text-gray-700 hover:underline disabled:opacity-50"
        >
          {locating ? 'Locating…' : '📍 Use my current location'}
        </button>
        {!hasPosition && <span className="text-xs text-gray-400">Click the map to drop a pin</span>}
      </div>
      {locateError && <p className="mt-1 text-xs text-red-600">{locateError}</p>}
    </div>
  );
}
