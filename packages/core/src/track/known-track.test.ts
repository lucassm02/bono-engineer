import type { Track, TrackCenterline } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import realLap from '../../../shared/src/tracks/fixtures/trial-mountain-real-lap.json';
import { identifyOrCreateTrack, lapPolyline, type TrackRepository } from './fingerprint.ts';

function memoryRepo(): TrackRepository & { tracks: Track[]; centerlines: TrackCenterline[] } {
  const tracks: Track[] = [];
  const centerlines: TrackCenterline[] = [];
  return {
    tracks,
    centerlines,
    listTracks: () => [...tracks],
    insertTrack: (t) => void tracks.push(t),
    saveCenterline: (c) => void centerlines.push(c),
  };
}

let seq = 0;
const input = (x: number[], z: number[]) => ({
  line: lapPolyline(x, z),
  sourceLapId: 'lap-1',
  newId: () => `t${++seq}`,
  now: 1000,
});

describe('identifyOrCreateTrack with the shipped track catalogue', () => {
  it('names a new track after the official layout when the real Trial Mountain lap matches', () => {
    const repo = memoryRepo();
    const r = identifyOrCreateTrack(repo, input(realLap.x, realLap.z));
    expect(r.created).toBe(true);
    expect(r.recognized?.layout.officialName).toBe('Trial Mountain Circuit');
    expect(r.track.name).toBe('Trial Mountain Circuit');
    expect(r.track.layout).toBeNull();
    expect(r.track.source).toBe('builtin');
    // the measured length is kept (not replaced by the official one)
    expect(r.track.lengthM).toBeGreaterThan(5300);
    expect(r.track.lengthM).toBeLessThan(5434);
    expect(repo.centerlines).toHaveLength(1);

    // the next lap on the same track matches the stored fingerprint, no new track
    const again = identifyOrCreateTrack(repo, input(realLap.x, realLap.z));
    expect(again.created).toBe(false);
    expect(again.track.id).toBe(r.track.id);
  });

  it('keeps "Pista desconhecida N" for a track the catalogue does not know', () => {
    const repo = memoryRepo();
    const n = 300;
    const x = Array.from({ length: n }, (_, i) => 400 * Math.cos((2 * Math.PI * i) / n));
    const z = Array.from({ length: n }, (_, i) => 250 * Math.sin((2 * Math.PI * i) / n));
    const r = identifyOrCreateTrack(repo, input(x, z));
    expect(r.created).toBe(true);
    expect(r.recognized ?? null).toBeNull();
    expect(r.track.name).toBe('Pista desconhecida 1');
    expect(r.track.source).toBe('auto');
  });

  it('names the Reverse layout when the same line is driven backwards', () => {
    const repo = memoryRepo();
    const r = identifyOrCreateTrack(
      repo,
      input([...realLap.x].reverse(), [...realLap.z].reverse()),
    );
    expect(r.track.name).toBe('Trial Mountain Circuit');
    expect(r.track.layout).toBe('Reverse');
  });
});
