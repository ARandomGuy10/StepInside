import apartment from '../scenes/home.json';
import villaFirst from '../scenes/villa-first.json';
import villaBFirst from '../scenes/villa-b-first.json';
import villaBGround from '../scenes/villa-b-ground.json';
import villaGround from '../scenes/villa-ground.json';
import villaCFirst from '../scenes/villa-c-first.json';
import villaCGround from '../scenes/villa-c-ground.json';
import villaCRoof from '../scenes/villa-c-roof.json';
import villaDFirst from '../scenes/villa-d-first.json';
import villaDGround from '../scenes/villa-d-ground.json';
import villaDRoof from '../scenes/villa-d-roof.json';
import villaEFirst from '../scenes/villa-e-first.json';
import villaEGround from '../scenes/villa-e-ground.json';
import villaERoof from '../scenes/villa-e-roof.json';
import type { Place } from './core/sun';

/** One storey of a home: a scene file, and how high its floor is. */
export interface LevelEntry {
  name: string;
  json: unknown;
  /** Height of this storey's floor above the ground, in metres. */
  elevation: number;
  /** Rooms with no ceiling, because a void in the storey above opens them up. */
  openCeilings?: readonly string[];
  /** An open roof terrace: it comes off together with the roof in the whole-house view. */
  roofTerrace?: boolean;
  /** Areas nobody can walk into, as [x0, y0, x1, y1] in plan metres: under a low roof, say. */
  keepOut?: readonly (readonly [number, number, number, number])[];
}

/**
 * A straight flight of stairs between two storeys, in plan metres. It
 * runs along the page's y axis: you step on at `yBottom` and off at `yTop`,
 * which may be either side of it.
 */
export interface StairEntry {
  lower: number;
  upper: number;
  x0: number;
  x1: number;
  yBottom: number;
  yTop: number;
  /** True when the flight stands free on its x0 side too, so it can only be stepped onto at its ends. */
  closedBothSides?: boolean;
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
  {
    id: 'villa-c',
    units: 'ft',
    design: { group: 'New house', name: 'Design C: curved roof' },
    title: 'New house',
    about: 'Design A\'s ground floor under a sculpted concrete roof that curls from the first floor up to a roof terrace, with a glass lounge, teak cladding and stairs to the roof.',
    levels: [
      { name: 'Ground floor', json: villaCGround, elevation: 0, openCeilings: ['living'] },
      // The planter under the low end of the curl is not walked on.
      { name: 'First floor', json: villaCFirst, elevation: 3.05, keepOut: [[13.25 * FT, 41.75 * FT, 16.75 * FT, 54.25 * FT]] },
      { name: 'Roof', json: villaCRoof, elevation: 6.1, roofTerrace: true },
    ],
    // Must match the staircases in scripts/make-villa.py. The second one
    // climbs towards the front, so its top step has the larger y.
    stairs: [
      { lower: 0, upper: 1, x0: 0.75 * FT, x1: 4.05 * FT, yBottom: 38.25 * FT, yTop: 24.25 * FT },
      { lower: 1, upper: 2, x0: 4.25 * FT, x1: 7.55 * FT, yBottom: 24.25 * FT, yTop: 38.25 * FT },
    ],
    start: { position: [16.25 * FT, 67 * FT], yawDeg: 0 },
    place: LUCKNOW,
  },
  {
    id: 'villa-d',
    units: 'ft',
    design: { group: 'New house', name: 'Design D: the architect\'s model' },
    title: 'New house',
    about: 'The curved-roof house copied from the architect\'s model: a concrete curl over the first floor, a glass living room behind a balcony, teak and stone, and a roof terrace. Design A\'s ground floor.',
    levels: [
      { name: 'Ground floor', json: villaDGround, elevation: 0, openCeilings: ['living'] },
      // The planter under the low end of the curl is not walked on.
      { name: 'First floor', json: villaDFirst, elevation: 3.05, keepOut: [[0.75 * FT, 50.75 * FT, 4.75 * FT, 54.25 * FT]] },
      { name: 'Roof', json: villaDRoof, elevation: 6.1, roofTerrace: true },
    ],
    // The same two flights as design C.
    stairs: [
      { lower: 0, upper: 1, x0: 0.75 * FT, x1: 4.05 * FT, yBottom: 38.25 * FT, yTop: 24.25 * FT },
      { lower: 1, upper: 2, x0: 4.25 * FT, x1: 7.55 * FT, yBottom: 24.25 * FT, yTop: 38.25 * FT },
    ],
    start: { position: [16.25 * FT, 67 * FT], yawDeg: 0 },
    place: LUCKNOW,
  },
  {
    id: 'villa-e',
    units: 'ft',
    design: { group: 'New house', name: 'Design E: the model, whole house' },
    title: 'New house',
    about: 'The architect\'s model on our plot, ground floor included: master and guest rooms, living, dining and kitchen around a rear pool court below; three bedrooms and a glass lounge under the concrete curl above; a stair room with a sweeping roof on top.',
    levels: [
      { name: 'Ground floor', json: villaEGround, elevation: 0, openCeilings: ['hall'] },
      // The garden under the curl and its planter ledge are not walked on.
      {
        name: 'First floor',
        json: villaEFirst,
        elevation: 3.05,
        openCeilings: ['stair2', 'lounge'],
        keepOut: [
          [0.75 * FT, 20.75 * FT, 2.0 * FT, 35.25 * FT],
          [0.75 * FT, 35.25 * FT, 11.0 * FT, 42.75 * FT],
          [0.75 * FT, 42.75 * FT, 4.75 * FT, 48.25 * FT],
        ],
      },
      // The low end of the curved roof and the planter on the slab are not walked on.
      {
        name: 'Roof',
        json: villaERoof,
        elevation: 6.1,
        roofTerrace: true,
        // The theater has no flat ceiling: the curved shell is its roof.
        openCeilings: ['theater'],
        keepOut: [
          [25.5 * FT, 16.25 * FT, 29.0 * FT, 34.0 * FT],
          [18.75 * FT, 37.75 * FT, 34.25 * FT, 41.75 * FT],
        ],
      },
    ],
    // The first flight climbs from the entrance hall in its own shaft; both climb towards the back.
    stairs: [
      { lower: 0, upper: 1, x0: 15.5 * FT, x1: 18.5 * FT, yBottom: 34.25 * FT, yTop: 20.25 * FT, closedBothSides: true },
      { lower: 1, upper: 2, x0: 12.0 * FT, x1: 15.0 * FT, yBottom: 34.25 * FT, yTop: 20.75 * FT },
    ],
    start: { position: [21.25 * FT, 64 * FT], yawDeg: 0 },
    place: LUCKNOW,
  },
];
