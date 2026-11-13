import { describe, expect, it } from 'vitest';
import { formatLength, formatSize, roomSize } from '../src/core/measure';

describe('formatLength', () => {
  it('writes metres with two decimals', () => {
    expect(formatLength(3.456, 'm')).toBe('3.46 m');
  });
  it('writes feet and inches to the nearest inch', () => {
    expect(formatLength(3.6576, 'ft')).toBe('12′');
    expect(formatLength(3.81, 'ft')).toBe('12′ 6″');
    expect(formatLength(0.3047, 'ft')).toBe('1′'); // rounds up to a whole foot, not 0′ 12″
  });
});

describe('roomSize', () => {
  it('measures the box round the room', () => {
    const size = roomSize({ id: 'a', name: 'A', polygon: [[1, 1], [4, 1], [4, 3], [1, 3]] });
    expect(size).toEqual({ width: 3, depth: 2, center: [2.5, 2] });
    expect(formatSize(size.width, size.depth, 'm')).toBe('3.00 × 2.00 m');
  });
});
