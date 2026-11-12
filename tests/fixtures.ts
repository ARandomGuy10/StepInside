/** A small valid scene: two 3 m rooms side by side with a 0.1 m wall between. */
export function twoRooms(): any {
  return {
    schemaVersion: 1,
    name: 'test',
    units: 'm',
    northDeg: 0,
    sun: { azimuthDeg: 180, elevationDeg: 40, intensity: 3, color: '#ffffff' },
    defaults: {
      ceilingHeight: 2.6,
      exteriorWallThickness: 0.3,
      railingHeight: 1,
      wallColor: '#ffffff',
      floorColor: '#aaaaaa',
      ceilingColor: '#ffffff',
    },
    rooms: [
      { id: 'a', name: 'A', polygon: [[0, 0], [3, 0], [3, 3], [0, 3]] },
      { id: 'b', name: 'B', polygon: [[3.1, 0], [6, 0], [6, 3], [3.1, 3]] },
    ],
    openings: [
      { id: 'door-ab', type: 'door', room: 'a', edge: 1, offset: 1, width: 0.9, height: 2.1 },
      { id: 'win-a', type: 'window', room: 'a', edge: 0, offset: 0.5, width: 1.2, height: 1.2, sill: 0.9 },
      { id: 'door-out', type: 'door', room: 'b', edge: 2, offset: 1, width: 0.9, height: 2.1 },
    ],
    furniture: [],
  };
}
