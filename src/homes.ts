import apartment from '../scenes/home.json';
import villaFirst from '../scenes/villa-first.json';
import villaGround from '../scenes/villa-ground.json';

/** The homes the start screen offers. Each one is a scene file in /scenes. */
export interface HomeEntry {
  id: string;
  title: string;
  about: string;
  json: unknown;
}

export const HOMES: readonly HomeEntry[] = [
  { id: 'apartment', title: 'Apartment', about: 'The Amsterdam apartment, furnished from photos.', json: apartment },
  { id: 'villa-ground', title: 'New house, ground floor', about: '35 × 55 ft plot: kitchen, master bedroom, dining and living, pool court, guest room and garden.', json: villaGround },
  { id: 'villa-first', title: 'New house, first floor', about: 'Three bedrooms, sitting lounge around the double-height void, and the balcony.', json: villaFirst },
];
