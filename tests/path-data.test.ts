import { describe, it, expect } from 'vitest';
import {
  parsePathData, walkPath, pathPoints, movePathPoint, insertPathPoint, removePathPoint, retractPathHandle, nearestPathSegment,
  smoothPathPoint, cornerPathPoint, anchorKind, curvePathSegment, straightenPathSegment, segmentCurved, handleMode, moveHandle, pointsAsPathData,
  parsePoints, polygonPoints, movePolygonPoint, insertPolygonPoint, removePolygonPoint, nearestPolygonEdge,
} from '../src/path-data';

const letters = (d: string) => parsePathData(d)!.map(s => s.letter + (s.letterAt === null ? '*' : ''));
const values = (d: string) => parsePathData(d)!.map(s => s.args.map(a => a.value));
const ends = (d: string) => walkPath(parsePathData(d)!).map(w => [w.end.x, w.end.y]);

describe('Path data parsing', () => {
  it('should read commands with their numbers and places', () => {
    const d = 'M10 20 L30 40 Z';
    expect(letters(d)).toEqual(['M', 'L', 'Z']);
    expect(values(d)).toEqual([[10, 20], [30, 40], []]);
    const [, line] = parsePathData(d)!;
    expect(d.slice(line.start, line.end)).toBe('L30 40');
    expect(d.slice(line.args[1].start, line.args[1].end)).toBe('40');
  });

  it('should split repeated groups into segments, an implicit L after an M', () => {
    expect(letters('M 0 0 10 10 L 1 2 3 4')).toEqual(['M', 'L*', 'L', 'L*']);
    expect(letters('m 0 0 10 10')).toEqual(['m', 'l*']);
  });

  it('should read numbers run together and arc flags without separators', () => {
    expect(values('M10-5L.5.5')).toEqual([[10, -5], [0.5, 0.5]]);
    expect(values('M0 0 a1 1 0 00 10 10')).toEqual([[0, 0], [1, 1, 0, 0, 0, 10, 10]]);
    expect(values('M1e1,2E-1')).toEqual([[10, 0.2]]);
  });

  it('should refuse what it cannot read', () => {
    expect(parsePathData('M 1 2 X 3')).toBeNull();
    expect(parsePathData('M 1 2 Z 3')).toBeNull();
    expect(parsePathData('1 2')).toBeNull();
    expect(parsePathData('M 1')).toBeNull();
  });
});

describe('Path data geometry', () => {
  it('should walk absolute and relative commands to absolute points', () => {
    expect(ends('M10 10 l5 0 v5 h-5 z')).toEqual([[10, 10], [15, 10], [15, 15], [10, 15], [10, 10]]);
    const w = walkPath(parsePathData('m 0 0 c 1 2 3 4 5 6')!)[1];
    expect([w.cp1, w.cp2, w.end]).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }]);
  });

  it('should imply the first handle of an S or T by reflection', () => {
    expect(walkPath(parsePathData('M0 0 C 0 10 10 10 10 0 S 20 -10 20 0')!)[2].cp1).toEqual({ x: 10, y: -10 });
    expect(walkPath(parsePathData('M0 0 Q 5 10 10 0 T 20 0')!)[2].cp1).toEqual({ x: 15, y: -10 });
    // with no curve before it, the handle sits on the point
    expect(walkPath(parsePathData('M0 0 L5 5 S 20 -10 20 0')!)[2].cp1).toEqual({ x: 5, y: 5 });
  });

  it('should offer a closed subpath\'s first point once when its last segment ends on it', () => {
    const slots = (d: string) => pathPoints(parsePathData(d)!).map(p => `${p.segment}:${p.slot}`);
    expect(slots('M0 0 L20 0 C20 20 10 10 0 0 Z')).toEqual(['0:end', '1:end', '2:cp1', '2:cp2']);
    expect(slots('m0 0 l.1 0 l.2 0 l-.3 0 z')).toEqual(['0:end', '1:end', '2:end']);
    // a point one unit away is a point of its own
    expect(slots('M0 0 L10 0 L0 1 Z')).toEqual(['0:end', '1:end', '2:end']);
    expect(slots('M0 0 L10 0 L0 0')).toEqual(['0:end', '1:end', '2:end']);
  });

  it('should offer every anchor and the handles a curve writes out', () => {
    const pts = pathPoints(parsePathData('M0 0 C0 10 10 10 10 0 S20 -10 20 0 Q25 5 30 0 Z')!);
    expect(pts.map(p => `${p.segment}:${p.slot}`)).toEqual(['0:end', '1:cp1', '1:cp2', '1:end', '2:cp2', '2:end', '3:cp1', '3:end']);
    expect(pts[1].anchors).toEqual([{ x: 0, y: 0 }]);
    expect(pts[6].anchors).toEqual([{ x: 20, y: 0 }, { x: 30, y: 0 }]);
  });
});

describe('Moving a path point', () => {
  it('should rewrite only the point that moved in an absolute path', () => {
    expect(movePathPoint('M10 10 L30 10 L30 30', { segment: 1, slot: 'end' }, { x: 40, y: 12 }, 0)).toBe('M10 10 L40 12 L30 30');
    expect(movePathPoint('M 0,0 L 10,0 L 20,0', { segment: 1, slot: 'end' }, { x: 11, y: 0 }, 0)).toBe('M 0,0 L 11,0 L 20,0');
  });

  it('should keep the points after it in place when the path is relative', () => {
    expect(movePathPoint('m10 10 l20 0 l0 20', { segment: 1, slot: 'end' }, { x: 40, y: 12 }, 0)).toBe('m10 10 l30 2 l-10 18');
    expect(movePathPoint('M10 10 L20 10 Z l5 5', { segment: 0, slot: 'end' }, { x: 12, y: 12 }, 0)).toBe('M12 12 L20 10 Z l3 3');
  });

  it('should turn an H or V into an L when its end leaves the line', () => {
    expect(movePathPoint('M0 0 H10 V10', { segment: 1, slot: 'end' }, { x: 10, y: 5 }, 0)).toBe('M0 0 L10 5 V10');
    expect(movePathPoint('M0 0 H10 V10', { segment: 2, slot: 'end' }, { x: 12, y: 10 }, 0)).toBe('M0 0 H10 L12 10');
    // a point only moves itself: the V's end stays put, so it is no longer straight above
    expect(movePathPoint('M0 0 H10 V10', { segment: 1, slot: 'end' }, { x: 12, y: 0 }, 0)).toBe('M0 0 H12 L10 10');
    expect(movePathPoint('M0 0 H10 V10 H0', { segment: 1, slot: 'end' }, { x: 10, y: 0 }, 0)).toBe('M0 0 H10 V10 H0');
    expect(movePathPoint('M0 0 L5 0 H10', { segment: 1, slot: 'end' }, { x: 5, y: 3 }, 0)).toBe('M0 0 L5 3 L10 0');
  });

  it('should take an anchor\'s handles along and leave the far ones', () => {
    expect(movePathPoint('M0 0 C0 10 10 10 10 0 C10 -10 20 -10 20 0', { segment: 1, slot: 'end' }, { x: 12, y: 2 }, 0))
      .toBe('M0 0 C0 10 12 12 12 2 C12 -8 20 -10 20 0');
    expect(movePathPoint('M0 0 C0 10 10 10 10 0 S20 -10 20 0', { segment: 2, slot: 'end' }, { x: 22, y: 0 }, 0))
      .toBe('M0 0 C0 10 10 10 10 0 S22 -10 22 0');
  });

  it('should move a handle on its own', () => {
    expect(movePathPoint('M0 0 C0 10 10 10 10 0', { segment: 1, slot: 'cp1' }, { x: 1, y: 1 }, 0)).toBe('M0 0 C1 1 10 10 10 0');
    expect(movePathPoint('M0 0 Q5 10 10 0', { segment: 1, slot: 'cp1' }, { x: 5, y: 12 }, 0)).toBe('M0 0 Q5 12 10 0');
    expect(movePathPoint('m0 0 c0 10 10 10 10 0', { segment: 1, slot: 'cp2' }, { x: 8, y: 8 }, 0)).toBe('m0 0 c0 10 8 8 10 0');
  });

  it('should write numbers as finely as they were, or as the drag needs', () => {
    expect(movePathPoint('M0 0 L10.5 0', { segment: 1, slot: 'end' }, { x: 12.25, y: 0 }, 0)).toBe('M0 0 L12.3 0');
    expect(movePathPoint('M0 0 L10 0', { segment: 1, slot: 'end' }, { x: 12.25, y: 0 }, 2)).toBe('M0 0 L12.25 0');
  });

  it('should keep numbers apart that a sign kept apart', () => {
    expect(movePathPoint('M0 0L10-5', { segment: 1, slot: 'end' }, { x: 10, y: 3 }, 0)).toBe('M0 0L10 3');
    expect(movePathPoint('M0 0c1-2,3-4,5-6', { segment: 1, slot: 'end' }, { x: 5, y: 6 }, 0)).toBe('M0 0c1-2,3 8,5 6');
    expect(movePathPoint('M0 0L1-.5', { segment: 1, slot: 'end' }, { x: 1, y: 0.5 }, 0)).toBe('M0 0L1 0.5');
    expect(movePathPoint('M0 0L1.5-.5', { segment: 1, slot: 'end' }, { x: 1.5, y: -0.25 }, 2)).toBe('M0 0L1.5-0.25');
  });

  it('should keep the numbers of a point whose letter changes around it', () => {
    expect(movePathPoint('M0 0 H10.5 V10', { segment: 1, slot: 'end' }, { x: 11, y: 0 }, 0)).toBe('M0 0 H11 L10.5 10');
    expect(movePathPoint('M0 0 L1 2.25 H10', { segment: 1, slot: 'end' }, { x: 1, y: 3 }, 0)).toBe('M0 0 L1 3 L10 2.25');
  });

  it('should give a group its letter back when the letter it borrowed changes', () => {
    expect(movePathPoint('M0 0 H10 20 30', { segment: 1, slot: 'end' }, { x: 10, y: 5 }, 0)).toBe('M0 0 L10 5 L20 0 H30');
    expect(movePathPoint('m0 0 h10 20 30', { segment: 1, slot: 'end' }, { x: 10, y: 5 }, 0)).toBe('m0 0 l10 5 l20 -5 h30');
  });

  it('should move a subpath\'s first point with the end that closes onto it', () => {
    expect(movePathPoint('M0 0 L20 0 C20 20 10 10 0 0 Z', { segment: 0, slot: 'end' }, { x: 5, y: 5 }, 0)).toBe('M5 5 L20 0 C20 20 15 15 5 5 Z');
    expect(movePathPoint('m0 0 l20 0 c0 20 -10 10 -20 0 z', { segment: 0, slot: 'end' }, { x: 5, y: 5 }, 0)).toBe('m5 5 l15 -5 c0 20 -5 15 -15 5 z');
  });

  it('should refuse a Z, a handle a command does not have, or a path it cannot read', () => {
    expect(movePathPoint('M0 0 L1 1 Z', { segment: 2, slot: 'end' }, { x: 0, y: 0 }, 0)).toBeNull();
    expect(movePathPoint('M0 0 L1 1', { segment: 1, slot: 'cp1' }, { x: 0, y: 0 }, 0)).toBeNull();
    expect(movePathPoint('M0 0 L1', { segment: 1, slot: 'end' }, { x: 0, y: 0 }, 0)).toBeNull();
  });
});

describe('Adding a path point', () => {
  it('should split a line into two of the same kind', () => {
    expect(insertPathPoint('M0 0 L10 0 L10 10', 1, 0.5, 0)).toBe('M0 0 L5 0 L10 0 L10 10');
    expect(insertPathPoint('m0 0 l10 0', 1, 0.5, 0)).toBe('m0 0 l5 0 l5 0');
    expect(insertPathPoint('M0 0 H10', 1, 0.5, 0)).toBe('M0 0 H5 H10');
    expect(insertPathPoint('M0 0 10 0 20 0', 1, 0.5, 0)).toBe('M0 0 L5 0 L10 0 20 0');
  });

  it('should split curves without changing their shape', () => {
    expect(insertPathPoint('M0 0 C0 10 10 10 10 0', 1, 0.5, 1)).toBe('M0 0 C0 5 2.5 7.5 5 7.5 C7.5 7.5 10 5 10 0');
    expect(insertPathPoint('M0 0 Q5 10 10 0', 1, 0.5, 1)).toBe('M0 0 Q2.5 5 5 5 Q7.5 5 10 0');
  });

  it('should write out an S or T that followed the split segment', () => {
    expect(insertPathPoint('M0 0 C0 10 10 10 10 0 S20 -10 20 0', 1, 0.5, 1))
      .toBe('M0 0 C0 5 2.5 7.5 5 7.5 C7.5 7.5 10 5 10 0 C10 -10 20 -10 20 0');
  });

  it('should give the groups after a split the letter they borrowed', () => {
    expect(insertPathPoint('M0 0 C0 10 10 10 10 0 S20 -10 20 0 30 10 30 0', 1, 0.5, 1))
      .toBe('M0 0 C0 5 2.5 7.5 5 7.5 C7.5 7.5 10 5 10 0 C10 -10 20 -10 20 0 S30 10 30 0');
    expect(insertPathPoint('M0 0 S20 -10 20 0 30 10 30 0', 1, 0.5, 1))
      .toBe('M0 0 C0 0 5 -2.5 10 -3.8 C15 -5 20 -5 20 0 C20 10 30 10 30 0');
  });

  it('should put a point on the closing line of a Z', () => {
    expect(insertPathPoint('M0 0 L10 0 L10 10 Z', 3, 0.5, 0)).toBe('M0 0 L10 0 L10 10 L5 5 Z');
  });

  it('should refuse an M and an arc', () => {
    expect(insertPathPoint('M0 0 L10 0', 0, 0.5, 0)).toBeNull();
    expect(insertPathPoint('M0 0 A5 5 0 0 1 10 0', 1, 0.5, 0)).toBeNull();
  });
});

describe('Removing a path point', () => {
  it('should drop the point and keep what follows in place', () => {
    expect(removePathPoint('M0 0 L10 0 L10 10 L0 10 Z', 1, 0)).toBe('M0 0 L10 10 L0 10 Z');
    expect(removePathPoint('m0 0 l10 0 l0 10', 1, 0)).toBe('m0 0 l10 10');
    expect(removePathPoint('M0 0 L5 5 H10', 1, 0)).toBe('M0 0 L10 5');
    expect(removePathPoint('M0 0 C0 10 10 10 10 0 S20 -10 20 0', 1, 0)).toBe('M0 0 C10 -10 20 -10 20 0');
  });

  it('should keep a letter that the next group still needs', () => {
    expect(removePathPoint('M0 0 L1 1 2 2 3 3', 1, 0)).toBe('M0 0 L2 2 3 3');
    expect(removePathPoint('M0 0 L1 1 2 2 3 3', 2, 0)).toBe('M0 0 L1 1 3 3');
  });

  it('should write out a group that leaned on the point that went', () => {
    expect(removePathPoint('M0 0 C0 10 10 10 10 0 S20 -10 20 0 30 10 30 0', 2, 0)).toBe('M0 0 C0 10 10 10 10 0 C20 10 30 10 30 0');
    expect(removePathPoint('M0 0 L10 0 S20 -10 20 0 30 10 30 0', 2, 0)).toBe('M0 0 L10 0 C20 10 30 10 30 0');
  });

  it('should keep every digit of a relative command whose start moved', () => {
    expect(removePathPoint('m0 0 l1.25 0 l1 1 m3 0', 2, 0)).toBe('m0 0 l1.25 0 m4 1');
    expect(removePathPoint('m0 0 c1 1 2 2 3.125 0 m1 0', 1, 0)).toBe('m0 0 m4.125 0');
  });

  it('should make the next point the start when the first point goes', () => {
    expect(removePathPoint('M0 0 L10 0 L20 0', 0, 0)).toBe('M10 0 L20 0');
    expect(removePathPoint('M0 0 C1 1 2 2 10 0 L20 0', 0, 0)).toBe('M10 0 L20 0');
    expect(removePathPoint('M0 0 L1 1 2 2', 0, 0)).toBe('M1 1 L2 2');
    expect(removePathPoint('M0 0 1 1 2 2', 0, 0)).toBe('M1 1 2 2');
    // a bare group after the new M reads by the M's case, so a relative one keeps its letter
    expect(removePathPoint('M0 0 l10 10 20 20', 0, 0)).toBe('M10 10 l20 20');
    expect(removePathPoint('m0 0 L10 10 20 20', 0, 0)).toBe('m10 10 L20 20');
    expect(removePathPoint('M0 0 C1 1 2 2 3 3 4 4 5 5 6 6', 0, 0)).toBe('M3 3 C4 4 5 5 6 6');
  });

  it('should take a subpath with nothing left to draw away entirely', () => {
    expect(removePathPoint('M0 0 Z', 0, 0)).toBe('');
    expect(removePathPoint('M0 0 L5 5 Z M10 10 Z', 3, 0)).toBe('M0 0 L5 5 Z');
    expect(removePathPoint('M0 0 L1 1 Z', 2, 0)).toBeNull();
    expect(removePathPoint('M0 0 C10 -10 10 10 0 0 Z M30 0 L40 0', 0, 0)).toBe('M30 0 L40 0');
  });

  it('should join the neighbours of a closed subpath\'s first point when it goes', () => {
    const d = 'M0 0 L20 0 L20 20 L0 20 C-5 15 -5 5 0 0 Z';
    expect(removePathPoint(d, 0, 0)).toBe('M0 20 L20 0 L20 20 L0 20 Z');
    expect(pathPoints(parsePathData(removePathPoint(d, 0, 0)!)!).map(p => `${p.segment}:${p.slot}`)).toEqual(['0:end', '1:end', '2:end']);
    expect(removePathPoint('m0 0 l20 0 l0 20 l-20 0 l0 -20 z', 0, 0)).toBe('m0 20 l20 -20 l0 20 l-20 0 z');
  });
});

describe('Retracting a handle', () => {
  it('should put a cubic\'s handle on its anchor, and write a straight cubic as a line', () => {
    expect(retractPathHandle('M0 0 C0 10 10 10 10 0', { segment: 1, slot: 'cp2' }, 0)).toBe('M0 0 C0 10 10 0 10 0');
    expect(retractPathHandle('M0 0 C0 10 10 0 10 0', { segment: 1, slot: 'cp1' }, 0)).toBe('M0 0 L10 0');
    expect(retractPathHandle('m0 0 c0 0 5 0 10 0', { segment: 1, slot: 'cp2' }, 0)).toBe('m0 0 l10 0');
    expect(retractPathHandle('M0 0 C0 10 10 10 10 0 S20 -10 20 0', { segment: 2, slot: 'cp2' }, 0)).toBe('M0 0 C0 10 10 10 10 0 S20 0 20 0');
  });

  it('should make a quadratic a line, writing out a T that leaned on it', () => {
    expect(retractPathHandle('M0 0 Q5 10 10 0', { segment: 1, slot: 'cp1' }, 0)).toBe('M0 0 L10 0');
    expect(retractPathHandle('M0 0 Q5 10 10 0 T20 0', { segment: 1, slot: 'cp1' }, 0)).toBe('M0 0 L10 0 Q15 -10 20 0');
  });

  it('should refuse a segment with no such handle', () => {
    expect(retractPathHandle('M0 0 L10 0', { segment: 1, slot: 'cp1' }, 0)).toBeNull();
    expect(retractPathHandle('M0 0 C0 10 10 10 10 0 S20 -10 20 0', { segment: 2, slot: 'cp1' }, 0)).toBeNull();
  });

  it('should not offer a handle that sits on its anchor', () => {
    const slots = (d: string) => pathPoints(parsePathData(d)!).map(p => `${p.segment}:${p.slot}`);
    expect(slots('M0 0 C0 0 10 10 10 0')).toEqual(['0:end', '1:cp2', '1:end']);
    expect(slots('M0 0 Q0 0 10 0')).toEqual(['0:end', '1:end']);
  });
});

describe('Finding the nearest segment', () => {
  it('should pick the segment and the spot on it closest to a point', () => {
    const near = nearestPathSegment('M0 0 L10 0 L10 10', { x: 5, y: 1 })!;
    expect(near.segment).toBe(1);
    expect(near.t).toBeCloseTo(0.5, 2);
    expect(near.distance).toBeCloseTo(1, 2);
    expect(nearestPathSegment('M0 0 L10 0 L10 10', { x: 11, y: 5 })!.segment).toBe(2);
    expect(nearestPathSegment('M0 0 L10 0 L10 10 Z', { x: 4, y: 6 })!.segment).toBe(3);
  });

  it('should measure along a curve', () => {
    const near = nearestPathSegment('M0 0 C0 10 10 10 10 0', { x: 5, y: 7.5 })!;
    expect(near.t).toBeCloseTo(0.5, 2);
    expect(near.distance).toBeCloseTo(0, 2);
  });
});

describe('Polygon points', () => {
  it('should read pairs and refuse an odd count', () => {
    expect(polygonPoints('0,0 10,0 10,10')).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(parsePoints('0,0 10')).toBeNull();
    expect(parsePoints('0,0 x')).toBeNull();
  });

  it('should move, add, and remove points in the attribute\'s own style', () => {
    expect(movePolygonPoint('0,0 10,0 10,10', 1, { x: 12, y: 1 }, 0)).toBe('0,0 12,1 10,10');
    expect(insertPolygonPoint('0,0 10,0 10,10', 0, { x: 5, y: 0 }, 0)).toBe('0,0 5,0 10,0 10,10');
    expect(insertPolygonPoint('0 0, 10 0, 10 10', 0, { x: 5, y: 0 }, 0)).toBe('0 0, 5 0, 10 0, 10 10');
    expect(removePolygonPoint('0,0 10,0 10,10', 1)).toBe('0,0 10,10');
    expect(removePolygonPoint('0,0 10,0 10,10', 0)).toBe('10,0 10,10');
    expect(removePolygonPoint('0,0 10,0 10,10', 2)).toBe('0,0 10,0');
  });

  it('should find the nearest edge, counting the closing edge of a polygon', () => {
    expect(nearestPolygonEdge('0,0 10,0 10,10', { x: 1, y: 5 }, false)!.index).toBe(0);
    expect(nearestPolygonEdge('0,0 10,0 10,10', { x: 1, y: 5 }, true)!.index).toBe(2);
  });
});

describe('Smooth and corner anchors', () => {
  it('should turn the lines beside a corner into curves tangent through it', () => {
    expect(smoothPathPoint('M0 0 L30 0 L30 30', 1, 0)).toBe('M0 0 C10 0 23 -7 30 0 C37 7 30 20 30 30');
    expect(smoothPathPoint('m0 0 l30 0 l0 30', 1, 0)).toBe('m0 0 c10 0 23 -7 30 0 c7 7 0 20 0 30');
    expect(smoothPathPoint('M0 0 h30 v30', 1, 0)).toBe('M0 0 c10 0 23 -7 30 0 c7 7 0 20 0 30');
  });

  it('should go round a closed subpath, putting the closing curve before the Z', () => {
    expect(smoothPathPoint('M0 0 L30 0 L30 30 Z', 0, 0)).toBe('M0 0 C4 -9 20 0 30 0 L30 30 C20 20 -5 13 0 0 Z');
  });

  it('should line up with an arc and leave the arc alone', () => {
    expect(smoothPathPoint('M0 0 L10 0 A10 10 0 0 1 30 0', 1, 1)).toBe('M0 0 C3.3 0 10 3.3 10 0 A10 10 0 0 1 30 0');
  });

  it('should refuse an open end', () => {
    expect(smoothPathPoint('M0 0 L10 0', 1, 0)).toBeNull();
    expect(smoothPathPoint('M0 0 L10 0', 0, 0)).toBeNull();
  });

  it('should retract handles to make a corner, writing a straight curve as a line', () => {
    expect(cornerPathPoint('M0 0 C10 0 23 -7 30 0 C37 7 30 20 30 30', 1, 0)).toBe('M0 0 L30 0 L30 30');
    expect(cornerPathPoint('M0 0 C0 10 10 10 10 0 S20 -10 20 0', 1, 0)).toBe('M0 0 C0 10 10 0 10 0 S20 -10 20 0');
    expect(cornerPathPoint('M0 0 L10 0 L10 10', 1, 0)).toBeNull();
  });

  it('should tell a smooth anchor from a corner', () => {
    expect(anchorKind('M0 0 C10 0 23 -7 30 0 C37 7 30 20 30 30', 1)).toBe('smooth');
    expect(anchorKind('M0 0 L30 0 L30 30', 1)).toBe('corner');
    // lines running straight on have no curve to be smooth
    expect(anchorKind('M0 0 L10 0 L20 0', 1)).toBe('corner');
    expect(anchorKind('M0 0 L10 0 C20 0 20 10 20 20', 1)).toBe('smooth');
    expect(anchorKind('M0 0 L10 0', 1)).toBeNull();
    expect(anchorKind('M0 0 C4 -9 20 0 30 0 L30 30 C20 20 -5 13 0 0 Z', 0)).toBe('smooth');
  });
});

describe('Curved and straight segments', () => {
  it('should make a line a curve with handles at its thirds', () => {
    expect(curvePathSegment('M10 10 l20 0', 1, 0)).toBe('M10 10 c7 0 13 0 20 0');
    expect(curvePathSegment('M10 10 h20.25', 1, 0)).toBe('M10 10 c6.75 0 13.5 0 20.25 0');
    expect(curvePathSegment('m0 0 l30 0 l0 30z', 3, 0)).toBe('m0 0 l30 0 l0 30c-10 -10 -20 -20 -30 -30 z');
    expect(curvePathSegment('M0 0 L10 0 20 0 30 0', 2, 0)).toBe('M0 0 L10 0 C13 0 17 0 20 0 L30 0');
    expect(curvePathSegment('M0 0 C0 10 10 10 10 0', 1, 0)).toBeNull();
    expect(curvePathSegment('M0 0 L10 0 L0 0 Z', 3, 0)).toBeNull();
  });

  it('should make a curve straight, writing out the S or T that leaned on it', () => {
    expect(straightenPathSegment('m0 0 c0 10 10.5 10 10.5 0', 1, 0)).toBe('m0 0 l10.5 0');
    expect(straightenPathSegment('M0 0 C0 10 10 10 10 0 S20 -10 20 0', 1, 0)).toBe('M0 0 L10 0 C10 -10 20 -10 20 0');
    expect(straightenPathSegment('M0 0 Q5 10 10 0 T20 0 T30 0', 1, 0)).toBe('M0 0 L10 0 Q15 -10 20 0 T30 0');
    expect(straightenPathSegment('M0 0 L30 0 L30 30 C20 20 10 10 0 0 Z', 3, 0)).toBe('M0 0 L30 0 L30 30 Z');
  });

  it('should tell a curve from a line by its letter', () => {
    expect(segmentCurved('M0 0 C0 10 10 10 10 0', 1)).toBe(true);
    expect(segmentCurved('M0 0 C3 0 7 0 10 0', 1)).toBe(true);
    expect(segmentCurved('M0 0 L10 0 Z', 2)).toBe(false);
    expect(segmentCurved('M0 0 L10 0', 1)).toBe(false);
    expect(segmentCurved('M0 0 A5 5 0 0 1 10 0', 1)).toBe(true);
  });
});

describe('Handle modes', () => {
  it('should read the mode from where the handles are', () => {
    expect(handleMode('M0 0 C0 10 10 10 10 0 C10 -10 20 -10 20 0', { segment: 1, slot: 'cp2' })).toBe('mirrored');
    expect(handleMode('M0 0 C0 10 10 5 10 0 C10 -10 20 -10 20 0', { segment: 1, slot: 'cp2' })).toBe('aligned');
    expect(handleMode('M0 0 C0 10 12 10 10 0 C10 -10 20 -10 20 0', { segment: 1, slot: 'cp2' })).toBe('independent');
    expect(handleMode('M0 0 C1 4 7.33 6.67 10 3.33 C12.67 0 20 -10 20 0', { segment: 1, slot: 'cp2' })).toBe('mirrored');
    expect(handleMode('M0 0 C0 10 10 10 10 0 S20 -10 20 0', { segment: 1, slot: 'cp2' })).toBe('mirrored');
    expect(handleMode('M0 0 C0 10 10 10 10 0 C10 -10 20 -10 20 0', { segment: 2, slot: 'cp1' })).toBe('mirrored');
    expect(handleMode('M0 0 C0 10 10 10 10 0 L20 0', { segment: 1, slot: 'cp2' })).toBe('independent');
  });

  it('should move the handle across the anchor as the mode says', () => {
    const d = 'M0 0 C0 10 10 10 10 0 C10 -10 20 -20 20 0';
    expect(moveHandle(d, { segment: 1, slot: 'cp2' }, { x: 4, y: 4 }, 'mirrored', 0)).toBe('M0 0 C0 10 4 4 10 0 C16 -4 20 -20 20 0');
    expect(moveHandle(d, { segment: 1, slot: 'cp2' }, { x: 4, y: 4 }, 'aligned', 0)).toBe('M0 0 C0 10 4 4 10 0 C18 -6 20 -20 20 0');
    expect(moveHandle(d, { segment: 1, slot: 'cp2' }, { x: 4, y: 4 }, 'independent', 0)).toBe('M0 0 C0 10 4 4 10 0 C10 -10 20 -20 20 0');
    expect(moveHandle('m0 0 c0 10 10 10 10 0 c0 -10 10 -20 10 0', { segment: 2, slot: 'cp1' }, { x: 13, y: -4 }, 'aligned', 0)).toBe('m0 0 c0 10 4 8 10 0 c3 -4 10 -20 10 0');
  });

  it('should keep an S while mirrored, and write it out when let go', () => {
    const d = 'M0 0 C0 10 10 10 10 0 S20 -10 20 0';
    expect(moveHandle(d, { segment: 1, slot: 'cp2' }, { x: 4, y: 4 }, 'mirrored', 0)).toBe('M0 0 C0 10 4 4 10 0 S20 -10 20 0');
    expect(moveHandle(d, { segment: 1, slot: 'cp2' }, { x: 4, y: 4 }, 'independent', 0)).toBe('M0 0 C0 10 4 4 10 0 C10 -10 20 -10 20 0');
  });

  it('should go round a closed subpath to the handle across its first point', () => {
    const d = 'M0 0 C0 -10 10 -10 10 0 C10 10 0 10 0 0 Z';
    expect(handleMode(d, { segment: 1, slot: 'cp1' })).toBe('mirrored');
    expect(moveHandle(d, { segment: 1, slot: 'cp1' }, { x: 5, y: -10 }, 'mirrored', 0)).toBe('M0 0 C5 -10 10 -10 10 0 C10 10 -5 10 0 0 Z');
  });
});

describe('Polygons as paths', () => {
  it('should read points as path data, keeping every number and separator', () => {
    expect(pointsAsPathData('0,0 10,0 10,10', true)).toBe('M0,0 10,0 10,10Z');
    expect(pointsAsPathData(' 0 0 10 0 ', false)).toBe('M0 0 10 0');
    expect(pointsAsPathData('0,0 10', true)).toBeNull();
  });
});
