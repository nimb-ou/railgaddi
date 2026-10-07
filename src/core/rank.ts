// Which places earn a photo bubble on the map, best first. The map shows as many as fit.
import type { Network, Place } from "./network";
import { worthwhile, type GuideView, type Photo } from "./places";
import { titleOf } from "./slugs";
import { km } from "./spots";
import type { Leg } from "./trips";

export interface BubbleCandidate {
  place: Place;
  title: string;
  photo: Photo | null;
  mins: number | null; // fastest ride from the origin; null when no origin is picked
  score: number;
}

// Destinations people cross the country for, most famous first (Wikivoyage titles).
// With no starting point picked they get first claim on a bubble, in this order.
export const ICONIC = [
  "Agra", "Varanasi", "Jaipur", "Goa", "Udaipur", "Mumbai", "Delhi", "Hampi", "Kochi", "Darjeeling",
  "Amritsar", "Mysore", "Jaisalmer", "Rishikesh", "Kolkata", "Puri", "Madurai", "Khajuraho", "Jodhpur", "Alappuzha",
  "Ooty", "Shimla", "Pondicherry", "Kanyakumari", "Rameswaram", "Haridwar", "Aurangabad", "Bodh Gaya", "Mahabalipuram",
  "Thanjavur", "Gokarna", "Varkala", "Konark", "Pushkar", "Bikaner", "Mount Abu", "Orchha", "Gwalior", "Hyderabad",
  "Chennai", "Guwahati", "Ujjain", "Sanchi", "Dwarka", "Somnath", "Tirupati", "Ajmer", "Matheran", "Bangalore",
];
const iconic = new Map(ICONIC.map((t, i) => [t, ICONIC.length - i]));

/**
 * A neighbourhood of the city you start from (Bellandur, from Bengaluru) isn't a trip: within
 * 20 km of its centre, or 12 km of any of its stations (Navi Mumbai, by Panvel; Thane), while
 * Chandannagar and Gandhinagar, a short ride out, still are.
 */
export function sameTown(a: Place | null, b: Place, net?: Network) {
  if (!a || a.lat === null || a.lon === null || b.lat === null || b.lon === null) return false;
  const to = { lat: b.lat, lon: b.lon };
  if (km({ lat: a.lat, lon: a.lon }, to) < 20) return true;
  return !!net && a.stations.length > 1 && a.stations.some((i) => {
    const s = net.stations[i];
    return s.lat !== null && s.lon !== null && km({ lat: s.lat, lon: s.lon }, to) < 12;
  });
}

export function rankPlaces(
  guides: Map<Place, GuideView>,
  reach: Map<Place, Leg[]> | null, // null: nothing picked yet, show inspiration
  hub: Place | null = null, // where the rides start (or end)
  net?: Network, // to know a city's own suburbs
): BubbleCandidate[] {
  const out: (BubbleCandidate & { guide: string })[] = [];
  const add = (place: Place, gv: GuideView, mins: number | null, score: number) => {
    if (!gv.icon || !worthwhile(gv)) return;
    const fame = iconic.get(gv.title);
    out.push({
      place,
      title: titleOf(place, gv),
      photo: gv.icon,
      mins,
      score: score + (fame ? (reach ? 0.8 : 10 + fame * 0.1) : 0),
      guide: gv.title,
    });
  };
  if (reach) {
    for (const [place, legs] of reach) {
      const gv = guides.get(place);
      const mins = Math.min(...legs.map((l) => l.dur));
      if (!gv || mins < 30 || sameTown(hub, place, net)) continue; // a neighbourhood of your own city isn't a trip
      add(place, gv, mins, Math.log1p(gv.entry.appeal) + 0.35 * Math.log1p(legs.length) + (place.isCity ? 0.4 : 0));
    }
  } else {
    for (const [place, gv] of guides) {
      // inspiration: rank by how much there is to see, not by how busy the station is
      if (place.halts) add(place, gv, null, Math.log1p(gv.entry.appeal) + (gv.banner ? 0.3 : 0));
    }
  }
  // one bubble per guide: a city's many stations, or two stations sharing a famous neighbour
  const best = new Map<string, BubbleCandidate & { guide: string }>();
  const pref = (c: BubbleCandidate) => c.score + (c.place.isCity ? 1 : 0) + c.place.halts * 1e-6;
  for (const c of out) {
    const prev = best.get(c.guide);
    if (!prev || pref(prev) < pref(c)) best.set(c.guide, c);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}
