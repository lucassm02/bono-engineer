/**
 * Car and state of the latest live frame, as React state refreshed twice a second. The live frame
 * lives outside React (live/liveStore.ts, a mutable holder read by the rAF loop); the capture page
 * only needs the car code of the replay, so a slow poll is enough and costs nothing.
 */

import type { ConnectionState } from '@gt7/shared';
import { useEffect, useState } from 'react';
import { live } from '../../live/liveStore.ts';

export interface LiveCar {
  /** Car of the latest fresh frame (null = none yet, stale, or 0 in a menu). */
  carCode: number | null;
  state: ConnectionState | null;
}

/** A frame older than this is considered gone (the console stopped sending). */
const STALE_MS = 3000;

export function readLiveCar(): LiveCar {
  const f = live.frame;
  if (!f || performance.now() - live.receivedAt > STALE_MS) return { carCode: null, state: null };
  return { carCode: f.car.carCode > 0 ? f.car.carCode : null, state: f.state };
}

export function useLiveCar(): LiveCar {
  const [car, setCar] = useState<LiveCar>(readLiveCar);
  useEffect(() => {
    const t = setInterval(() => {
      const n = readLiveCar();
      setCar((p) => (p.carCode === n.carCode && p.state === n.state ? p : n));
    }, 500);
    return () => clearInterval(t);
  }, []);
  return car;
}
