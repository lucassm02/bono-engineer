/**
 * What the app offers when it meets a track it has no name for: candidates from the geometric
 * recognition (./match.ts) and, when the geometry says nothing, from the lap length alone.
 * Pure: the server calls it with the stored centerline, the web only renders the result.
 */

import { lookAlikes, suggestLayoutsByLength, type TrackLayout } from './catalog.ts';
import { type LapLine, matchKnownTrack } from './match.ts';

export interface TrackRecognitionCandidate {
  /** Official layout id. */
  id: string;
  /** Name to save ("Autodromo Nazionale Monza"). */
  name: string;
  /** Layout label to save (null = none). */
  layout: string | null;
  displayName: string;
  /** Official length (m). */
  officialLengthM: number;
  turns: number;
  /** (measured − official) / official. */
  lengthErrRel: number;
  /** Where the suggestion comes from: the driven line, or the length alone. */
  basis: 'geometry' | 'length';
  /** 'high': the line matches; 'medium'/'low': similar line or length only. */
  confidence: 'high' | 'medium' | 'low';
  /** Mean deviation between the driven line and the known line (m); null for 'length'. */
  meanDevM: number | null;
  /** Other layouts that look the same to this comparison (names): ask the user to confirm. */
  lookAlikes: string[];
}

export interface TrackRecognition {
  /** Measured lap length (m). */
  lengthM: number;
  /** The driven line was compared with the shipped lines. */
  usedGeometry: boolean;
  /** The best candidate is strong and unambiguous (the app would name it by itself). */
  strong: boolean;
  /** Several candidates are too close to call. */
  ambiguous: boolean;
  candidates: TrackRecognitionCandidate[];
}

function candidateOf(
  l: TrackLayout,
  lengthErrRel: number,
  basis: 'geometry' | 'length',
  confidence: 'high' | 'medium' | 'low',
  meanDevM: number | null,
): TrackRecognitionCandidate {
  return {
    id: l.id,
    name: l.venue,
    layout: l.layoutLabel,
    displayName: l.displayName,
    officialLengthM: l.lengthM,
    turns: l.turns,
    lengthErrRel,
    basis,
    confidence,
    meanDevM,
    lookAlikes: lookAlikes(l).map((o) => o.displayName),
  };
}

/** Candidates for a track: geometry first (when a line is given), the length window as fallback. */
export function recognizeTrack(lengthM: number, line: LapLine | null): TrackRecognition {
  if (line) {
    const m = matchKnownTrack(line);
    if (m.candidates.length > 0) {
      return {
        lengthM: m.lengthM,
        usedGeometry: true,
        strong: m.auto !== null,
        ambiguous: m.ambiguous,
        candidates: m.candidates
          .slice(0, 4)
          .map((c) => candidateOf(c.layout, c.lengthErrRel, 'geometry', c.confidence, c.meanDevM)),
      };
    }
  }
  const byLength = suggestLayoutsByLength(lengthM, { max: 4 });
  return {
    lengthM,
    usedGeometry: line !== null,
    strong: false,
    ambiguous: byLength.length > 1,
    candidates: byLength.map((c) => candidateOf(c.layout, c.errorRel, 'length', 'low', null)),
  };
}
