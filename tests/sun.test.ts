import { describe, expect, it } from 'vitest';
import { clockText, sunPosition, sunTimes } from '../src/core/sun';

// Lucknow, India (city centre; the exact plot is not needed for the sun).
const lucknow = { lat: 26.85, lon: 80.95, utcOffset: 5.5 };

describe('sun position', () => {
  it('stands almost overhead at midsummer noon in Lucknow', () => {
    // Solar noon there is about 12:15 IST; the sun is 90 - (26.85 - 23.44) = 86.6 degrees up.
    const p = sunPosition(lucknow, 2026, 6, 21, 12.25);
    expect(p.elevationDeg).toBeGreaterThan(85.5);
  });

  it('is low in the south at midwinter noon', () => {
    const p = sunPosition(lucknow, 2026, 12, 21, 12.2);
    expect(p.elevationDeg).toBeCloseTo(90 - 26.85 - 23.44, 0);
    expect(p.azimuthDeg).toBeGreaterThan(170);
    expect(p.azimuthDeg).toBeLessThan(190);
  });

  it('rises in the east and sets in the west', () => {
    expect(sunPosition(lucknow, 2026, 3, 20, 7).azimuthDeg).toBeCloseTo(95, -1);
    expect(sunPosition(lucknow, 2026, 3, 20, 17.5).azimuthDeg).toBeCloseTo(265, -1);
  });

  it('gives sunrise and sunset times close to published ones', () => {
    // Published for Lucknow on 13 November: sunrise about 6:22 am, sunset about 5:13 pm.
    const t = sunTimes(lucknow, 2026, 11, 13);
    expect(Math.abs(t.rise - (6 + 22 / 60))).toBeLessThan(0.1);
    expect(Math.abs(t.set - (17 + 13 / 60))).toBeLessThan(0.1);
  });

  it('writes clock times', () => {
    expect(clockText(6.5)).toBe('6:30 am');
    expect(clockText(12)).toBe('12:00 pm');
    expect(clockText(17.25)).toBe('5:15 pm');
  });
});
