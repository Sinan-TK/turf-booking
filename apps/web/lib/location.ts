'use client';

import { useCallback, useEffect, useState } from 'react';
import { describeGeoError } from '@venue/shared/dist/location';
import { api } from '@/lib/api';

/**
 * Where the customer is searching. `district` = everything in a district, `town` = near a town's centre,
 * `geo` = near the customer's own position. Saved in the browser so it survives a reload.
 */
export interface LocationChoice {
  mode: 'district' | 'town' | 'geo';
  stateId: string;
  stateName: string;
  districtId: string;
  districtName: string;
  /** town mode */
  areaId?: string;
  townName?: string;
  /** town mode: the town's centre; geo mode: the customer's position */
  lat?: number;
  lng?: number;
  /** geo mode: the closest listed town, for the header ("Near Manjeri") */
  nearTown?: string;
}

export interface Town {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

/** Searches within this distance of a town's centre / of the customer. */
export const TOWN_RADIUS_KM = 10;
export const GEO_RADIUS_KM = 15;

/** The header's place name on one line: "Malappuram, Kerala", "Kottakkal, Malappuram" or "Near Tirur". */
export function placeLabel(choice: LocationChoice | null): string {
  if (!choice) return 'Select location';
  if (choice.mode === 'town') return `${choice.townName ?? choice.districtName}, ${choice.districtName}`;
  if (choice.mode === 'geo') return choice.nearTown ?? 'Your location';
  return choice.stateName ? `${choice.districtName}, ${choice.stateName}` : choice.districtName;
}

/** The same place on two lines for the header: the area ("Kottakkal") and under it the bigger place around it ("Malappuram"). */
export function placeLines(choice: LocationChoice | null): { primary: string; secondary: string | null } {
  if (!choice) return { primary: 'Select location', secondary: null };
  if (choice.mode === 'town') return { primary: choice.townName ?? choice.districtName, secondary: choice.townName ? choice.districtName : choice.stateName || null };
  if (choice.mode === 'geo') return { primary: choice.nearTown ?? 'Your location', secondary: choice.districtName || null };
  return { primary: choice.districtName, secondary: choice.stateName || null };
}

const STORAGE_KEY = 'venue.location.v1';
/** Opening choice for a first-time visitor. */
const DEFAULT_PLACE = { state: 'Kerala', district: 'Malappuram' };

function isChoice(v: unknown): v is LocationChoice {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    (c.mode === 'district' || c.mode === 'town' || c.mode === 'geo') &&
    typeof c.districtId === 'string' &&
    typeof c.districtName === 'string' &&
    typeof c.stateId === 'string' &&
    (c.mode === 'district' || (typeof c.lat === 'number' && typeof c.lng === 'number'))
  );
}

function readSaved(): LocationChoice | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isChoice(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function save(choice: LocationChoice) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Private mode or blocked storage: the choice just lasts until the page is closed.
  }
}

/** The default place (Malappuram, Kerala) as a district choice, or null if it isn't set up in this database. */
export async function loadDefaultChoice(): Promise<LocationChoice | null> {
  try {
    const states = await api.get<Array<{ id: string; name: string }>>('/states');
    const state = states.find((s) => s.name.toLowerCase() === DEFAULT_PLACE.state.toLowerCase());
    if (!state) return null;
    const districts = await api.get<Array<{ id: string; name: string }>>(`/districts?stateId=${state.id}`);
    const district = districts.find((d) => d.name.toLowerCase() === DEFAULT_PLACE.district.toLowerCase());
    if (!district) return null;
    return { mode: 'district', stateId: state.id, stateName: state.name, districtId: district.id, districtName: district.name };
  } catch {
    return null;
  }
}

/**
 * The customer's search location: the saved choice if there is one, otherwise Malappuram. `ready` turns true
 * once that has been worked out, so the page doesn't search before it knows where.
 */
export function useLocationChoice() {
  const [choice, setChoiceState] = useState<LocationChoice | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = readSaved() ?? (await loadDefaultChoice());
      if (cancelled) return;
      // A choice made while the default was still loading must not be overwritten by it.
      if (found) setChoiceState((current) => current ?? found);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setChoice = useCallback((next: LocationChoice) => {
    setChoiceState(next);
    save(next);
  }, []);

  return { choice, setChoice, ready };
}

/** The two lines of the header button: the place, and a hint of where it is. */
export function headerLines(choice: LocationChoice | null): { title: string; subtitle: string } {
  if (!choice) return { title: 'Select location', subtitle: 'Tap to choose' };
  if (choice.mode === 'town') return { title: choice.townName ?? choice.districtName, subtitle: `${choice.districtName}, ${choice.stateName}` };
  if (choice.mode === 'geo') {
    return {
      title: choice.nearTown ?? 'Your location',
      subtitle: 'Using your current location',
    };
  }
  return { title: choice.districtName, subtitle: choice.stateName || 'Tap to change' };
}

/** The search-URL part for a choice (everything but the date and filters). */
export function locationParams(choice: LocationChoice): Record<string, string> {
  if (choice.mode === 'district') return { districtId: choice.districtId };
  const radius = choice.mode === 'town' ? TOWN_RADIUS_KM : GEO_RADIUS_KM;
  return { lat: String(choice.lat), lng: String(choice.lng), radiusKm: String(radius) };
}

export type PositionResult = { ok: true; lat: number; lng: number } | { ok: false; message: string };

/**
 * Reads the device position. Explains why when it can't: an insecure address, a blocked permission, no
 * position found, or a timeout (tried once more with a relaxed setting before giving up).
 */
export async function getPosition(): Promise<PositionResult> {
  const secure = typeof window !== 'undefined' && window.isSecureContext;
  if (!secure) return { ok: false, message: describeGeoError(null, false) };
  if (!navigator.geolocation) return { ok: false, message: describeGeoError(null, true) };

  const attempt = (options: PositionOptions) =>
    new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
  try {
    let pos: GeolocationPosition;
    try {
      pos = await attempt({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 });
    } catch (err) {
      // A timeout deserves one more, longer, try; a refusal or a missing position does not.
      if ((err as GeolocationPositionError).code !== 3) throw err;
      pos = await attempt({ enableHighAccuracy: false, timeout: 20_000, maximumAge: 600_000 });
    }
    return { ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch (err) {
    return { ok: false, message: describeGeoError(err as GeolocationPositionError, true) };
  }
}
