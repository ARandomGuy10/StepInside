/**
 * Where the sun is in the sky for a place and a moment, using the NOAA
 * solar position formulas (accurate to well under a degree, which is plenty
 * for light and shadows).
 */

export interface Place {
  /** Degrees north of the equator. */
  lat: number;
  /** Degrees east of Greenwich. */
  lon: number;
  /** The local clock's offset from UTC, in hours (India: 5.5). */
  utcOffset: number;
}

export interface SunPosition {
  /** Compass bearing of the sun: 0 north, 90 east, 180 south, 270 west. */
  azimuthDeg: number;
  /** Height above the horizon; negative when the sun has set. */
  elevationDeg: number;
}

const rad = Math.PI / 180;

/** The sun's position on `date` (year, month 1-12, day) at `hours` local clock time. */
export function sunPosition(place: Place, year: number, month: number, day: number, hours: number): SunPosition {
  // Days since J2000.0 (noon UTC, 1 January 2000), from the UTC moment.
  const utc = Date.UTC(year, month - 1, day) + (hours - place.utcOffset) * 3600_000;
  const n = (utc - Date.UTC(2000, 0, 1, 12)) / 86_400_000;
  const T = n / 36525; // Julian centuries

  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360; // mean longitude
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T); // mean anomaly
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * rad) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));

  // The equation of time: how far sundial time runs ahead of clock time, in minutes.
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime =
    4 / rad *
    (y * Math.sin(2 * L0 * rad) -
      2 * e * Math.sin(M * rad) +
      4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
      0.5 * y * y * Math.sin(4 * L0 * rad) -
      1.25 * e * e * Math.sin(2 * M * rad));

  const solarMinutes = (((hours * 60 + eqTime + 4 * place.lon - 60 * place.utcOffset) % 1440) + 1440) % 1440;
  const hourAngle = (solarMinutes / 4 - 180) * rad;
  const lat = place.lat * rad;
  const cosZenith = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  const elevation = 90 - zenith / rad;
  // Bearing measured clockwise from north.
  const azimuth =
    (Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / rad + 180) % 360;
  return { azimuthDeg: azimuth, elevationDeg: elevation };
}

/** Sunrise and sunset in local clock hours for a day, found by searching the elevation. */
export function sunTimes(place: Place, year: number, month: number, day: number): { rise: number; set: number } {
  // The sun's upper edge touches the horizon at about -0.83 degrees (refraction and its radius).
  const up = (h: number) => sunPosition(place, year, month, day, h).elevationDeg > -0.833;
  const edge = (from: number, to: number): number => {
    let a = from;
    let b = to;
    for (let i = 0; i < 30; i++) {
      const mid = (a + b) / 2;
      if (up(mid) === up(a)) a = mid;
      else b = mid;
    }
    return (a + b) / 2;
  };
  return { rise: edge(0, 12), set: edge(12, 24) };
}

/** "6:05 am" style clock text for a number of hours. */
export function clockText(hours: number): string {
  let minutes = Math.round(hours * 60);
  const h24 = Math.floor(minutes / 60) % 24;
  minutes %= 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(minutes).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
}
