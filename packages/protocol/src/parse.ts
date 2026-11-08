/** Decrypted buffer → TelemetryPacket (study §5, little-endian). */

import {
  formatFromLength,
  formatIncludes,
  PACKET_SIZES,
  type PacketFormat,
  TELEMETRY_MAGIC,
  type TelemetryPacket,
  type Vec3,
  type Wheels,
} from '@gt7/shared';
import { GEAR_RATIO_SLOTS, OFFSETS as O } from './layout.ts';

export class PacketParseError extends Error {
  override name = 'PacketParseError';
}

function vec3(dv: DataView, off: number): Vec3 {
  return {
    x: dv.getFloat32(off, true),
    y: dv.getFloat32(off + 4, true),
    z: dv.getFloat32(off + 8, true),
  };
}

function wheels(dv: DataView, off: number): Wheels {
  return [
    dv.getFloat32(off, true),
    dv.getFloat32(off + 4, true),
    dv.getFloat32(off + 8, true),
    dv.getFloat32(off + 12, true),
  ];
}

function chars(buf: Uint8Array, off: number, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(String.fromCharCode(buf[off + i] ?? 0));
  return out;
}

/**
 * Parses a decrypted packet. The format is detected by length unless given (a longer buffer can be
 * parsed as a shorter format). Throws {@link PacketParseError} on size/magic problems.
 */
export function parsePacket(plain: Uint8Array, format?: PacketFormat): TelemetryPacket {
  const fmt = format ?? formatFromLength(plain.byteLength);
  if (fmt === null) throw new PacketParseError(`unknown packet size ${plain.byteLength}`);
  if (plain.byteLength < PACKET_SIZES[fmt]) {
    throw new PacketParseError(`buffer too short for format ${fmt}: ${plain.byteLength}`);
  }
  const dv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const magic = dv.getUint32(O.magic, true);
  if (magic !== TELEMETRY_MAGIC) {
    throw new PacketParseError(`bad magic 0x${magic.toString(16)}`);
  }

  const gearByte = plain[O.gear] ?? 0;
  const gearRatios: number[] = [];
  for (let i = 0; i < GEAR_RATIO_SLOTS; i++) {
    gearRatios.push(dv.getFloat32(O.gearRatios + i * 4, true));
  }

  const p: TelemetryPacket = {
    format: fmt,
    position: vec3(dv, O.position),
    velocity: vec3(dv, O.velocity),
    rotation: vec3(dv, O.rotation),
    relativeOrientationToNorth: dv.getFloat32(O.relativeOrientationToNorth, true),
    angularVelocity: vec3(dv, O.angularVelocity),
    bodyHeight: dv.getFloat32(O.bodyHeight, true),
    engineRpm: dv.getFloat32(O.engineRpm, true),
    fuelLevel: dv.getFloat32(O.fuelLevel, true),
    fuelCapacity: dv.getFloat32(O.fuelCapacity, true),
    speedMps: dv.getFloat32(O.speedMps, true),
    boost: dv.getFloat32(O.boost, true),
    oilPressure: dv.getFloat32(O.oilPressure, true),
    waterTemp: dv.getFloat32(O.waterTemp, true),
    oilTemp: dv.getFloat32(O.oilTemp, true),
    tyreTemp: wheels(dv, O.tyreTemp),
    packetId: dv.getInt32(O.packetId, true),
    lapCount: dv.getInt16(O.lapCount, true),
    totalLaps: dv.getInt16(O.totalLaps, true),
    bestLapMs: dv.getInt32(O.bestLapMs, true),
    lastLapMs: dv.getInt32(O.lastLapMs, true),
    timeOfDayMs: dv.getInt32(O.timeOfDayMs, true),
    preRacePosition: dv.getInt16(O.preRacePosition, true),
    numCarsPreRace: dv.getInt16(O.numCarsPreRace, true),
    rpmAlertMin: dv.getInt16(O.rpmAlertMin, true),
    rpmAlertMax: dv.getInt16(O.rpmAlertMax, true),
    calculatedMaxSpeedKmh: dv.getInt16(O.calculatedMaxSpeedKmh, true),
    flags: dv.getUint16(O.flags, true),
    gear: gearByte & 0x0f,
    suggestedGear: (gearByte >> 4) & 0x0f,
    throttle: plain[O.throttle] ?? 0,
    brake: plain[O.brake] ?? 0,
    roadPlane: vec3(dv, O.roadPlane),
    roadPlaneDistance: dv.getFloat32(O.roadPlaneDistance, true),
    wheelRps: wheels(dv, O.wheelRps),
    tyreRadius: wheels(dv, O.tyreRadius),
    suspensionHeight: wheels(dv, O.suspensionHeight),
    clutchPedal: dv.getFloat32(O.clutchPedal, true),
    clutchEngagement: dv.getFloat32(O.clutchEngagement, true),
    rpmClutchToGearbox: dv.getFloat32(O.rpmClutchToGearbox, true),
    transmissionTopSpeed: dv.getFloat32(O.transmissionTopSpeed, true),
    gearRatios,
    carCode: dv.getInt32(O.carCode, true),
  };

  if (formatIncludes(fmt, 'B')) {
    p.steeringAngle = dv.getFloat32(O.steeringAngle, true);
    p.steeringAngularVelocity = dv.getFloat32(O.steeringAngularVelocity, true);
    p.sway = dv.getFloat32(O.sway, true);
    p.heave = dv.getFloat32(O.heave, true);
    p.surge = dv.getFloat32(O.surge, true);
  }
  if (formatIncludes(fmt, '~')) {
    p.throttleRaw = plain[O.throttleRaw] ?? 0;
    p.brakeRaw = plain[O.brakeRaw] ?? 0;
    p.unknown0x13E = plain[O.unknown0x13E] ?? 0;
    p.energyRecoveryFlag = plain[O.energyRecoveryFlag] ?? 0;
    p.torqueVectoring = wheels(dv, O.torqueVectoring);
    p.energyRecovery = dv.getFloat32(O.energyRecovery, true);
    p.unknown0x154 = dv.getFloat32(O.unknown0x154, true);
  }
  if (formatIncludes(fmt, 'C')) {
    const s = chars(plain, O.surfaceTypes, 4);
    p.surfaceTypes = [s[0] ?? '\0', s[1] ?? '\0', s[2] ?? '\0', s[3] ?? '\0'];
    p.currentLapMs = dv.getInt32(O.currentLapMs, true);
    p.wheelSteerAngle = [
      dv.getFloat32(O.wheelSteerAngle, true),
      dv.getFloat32(O.wheelSteerAngle + 4, true),
    ];
    p.wheelbase = dv.getFloat32(O.wheelbase, true);
    const cat = chars(plain, O.carCategory, 4);
    while (cat.length > 0 && cat[cat.length - 1] === '\0') cat.pop(); // trim NUL padding
    p.carCategory = cat.join('');
  }
  return p;
}

/** Like {@link parsePacket} but returns null instead of throwing. */
export function tryParsePacket(plain: Uint8Array, format?: PacketFormat): TelemetryPacket | null {
  try {
    return parsePacket(plain, format);
  } catch {
    return null;
  }
}
