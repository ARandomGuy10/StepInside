import apartment from '../scenes/home.json';
import villaFirst from '../scenes/villa-first.json';
import villaBFirst from '../scenes/villa-b-first.json';
import villaBGround from '../scenes/villa-b-ground.json';
import villaGround from '../scenes/villa-ground.json';
import type { Place } from './core/sun';

/** One storey of a home: a scene file, and how high its floor is. */
export interface LevelEntry {
  name: string;
  json: unknown;
  /** Height of this storey's floor above the ground, in metres. */
  elevation: number;
  /** Rooms with no ceiling, because a void in the storey above opens them up. */
  openCeilings?: readonly string[];
}

/**
 * A straight flight of stairs between two storeys, in plan metres. It
 * runs along the page's y axis: you step on at `yBottom` and off at `yTop`.
 */
export interface StairEntry {
  lower: number;
  upper: number;
  x0: number;
  x1: number;
  yBottom: number;
  yTop: number;
}

/** A home the start screen offers. */
export interface HomeEntry {
  id: string;
  title: string;
  about: string;
  levels: readonly LevelEntry[];
  stairs?: readonly StairEntry[];
  /**
   * Set when a home has several designs to compare. Homes with the same
   * `group` are designs of one home: the start screen lists the group once,
   * and a dropdown switches between its designs.
   */
  design?: { group: string; name: string };
  /** How sizes are shown. The scene files are always in metres. */
  units?: 'm' | 'ft';
  /**
   * Where the home is, for the sun's path through the day. Homes without
   * one keep the fixed sun in their scene file.
   */
  place?: Place & { name: string };
  /** Where the walk begins, if not at the first storey's own start. */
  start?: { position: [number, number]; yawDeg: number };
}

const FT = 0.3048;

/** Lucknow city centre. The sun's path is the same anywhere in the city. */
const LUCKNOW = { name: 'Lucknow', lat: 26.85, lon: 80.95, utcOffset: 5.5 };

export const HOMES: readonly HomeEntry[] = [
  {
    id: 'apartment',
    title: 'Apartment',
    about: 'The Amsterdam apartment, furnished from photos.',
    levels: [{ name: 'Apartment', json: apartment, elevation: 0 }],
  },
  {
    id: 'villa',
    units: 'ft',
    design: { group: 'New house', name: 'Design A: pool at the side' },
    title: 'New house',
    about: '35 × 55 ft plot, two floors: living and dining round a pool court, four bedrooms, garden and balcony. The walk starts at the gate.',
    levels: [
      { name: 'Ground floor', json: villaGround, elevation: 0, openCeilings: ['living'] },
      { name: 'First floor', json: villaFirst, elevation: 3.05 },
    ],
    // Must match the staircase in scripts/make-villa.py.
    stairs: [{ lower: 0, upper: 1, x0: 0.75 * FT, x1: 4.05 * FT, yBottom: 38.25 * FT, yTop: 24.25 * FT }],
    start: { position: [16.25 * FT, 67 * FT], yawDeg: 0 },
    place: LUCKNOW,
  },
  {
    id: 'villa-b',
    units: 'ft',
    design: { group: 'New house', name: 'Design B: courtyard house' },
    title: 'New house',
    about: 'The same plot as a courtyard house: one open living space between a private pool court with its own shower and a bigger front garden.',
    levels: [
      { name: 'Ground floor', json: villaBGround, elevation: 0, openCeilings: ['great'] },
      { name: 'First floor', json: villaBFirst, elevation: 3.05 },
    ],
    // Must match the staircase in scripts/make-villa.py.
    stairs: [{ lower: 0, upper: 1, x0: 0.75 * FT, x1: 4.5 * FT, yBottom: 39.25 * FT, yTop: 25.75 * FT }],
    start: { position: [17.75 * FT, 67 * FT], yawDeg: 0 },
    place: LUCKNOW,
  },
];
