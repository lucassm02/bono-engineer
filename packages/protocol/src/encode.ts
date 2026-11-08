/** TelemetryPacket → decrypted (plaintext) buffer. Used by the simulator and tests. */

import {
  formatIncludes,
  PACKET_SIZES,
  type PacketFormat,
  TELEMETRY_MAGIC,
  type TelemetryPacket,
  type Vec3,
  type Wheels,
} from '@gt7/shared';
import { GEAR_RATIO_SLOTS, OFFSETS as O } from './layout.ts';

function setVec3(dv: DataView, off: number, v: Vec3): void {
  dv.setFloat32(off, v.x, true);
  dv.setFloat32(off + 4, v.y, true);
  dv.setFloat32(off + 8, v.z, true);
}

function setWheels(dv: DataView, off: number, w: Wheels | undefined): void {
  for (let i = 0; i < 4; i++) dv.setFloat32(off + i * 4, w?.[i] ?? 0, true);
}

function setChars(buf: Uint8Array, off: number, n: number, s: string | readonly string[]): void {
  const str = typeof s === 'string' ? s : s.join('');
  for (let i = 0; i < n; i++) buf[off + i] = i < str.length ? str.charCodeAt(i) & 0xff : 0;
}

const u8 = (v: number | undefined) => Math.max(0, Math.min(255, Math.round(v ?? 0)));

/**
 * Encodes a packet as plaintext of `format` size (default: `p.format`). Extended fields missing
 * from `p` are written as 0. Bytes 0x40..0x43 (IV seed) and reserved regions are 0.
 */
export function encodePacket(p: TelemetryPacket, format: PacketFormat = p.format): Uint8Array {
  const buf = new Uint8Array(PACKET_SIZES[format]);
  const dv = new DataView(buf.buffer);
  dv.setUint32(O.magic, TELEMETRY_MAGIC, true);
  setVec3(dv, O.position, p.position);
  setVec3(dv, O.velocity, p.velocity);
  setVec3(dv, O.rotation, p.rotation);
  dv.setFloat32(O.relativeOrientationToNorth, p.relativeOrientationToNorth, true);
  setVec3(dv, O.angularVelocity, p.angularVelocity);
  dv.setFloat32(O.bodyHeight, p.bodyHeight, true);
  dv.setFloat32(O.engineRpm, p.engineRpm, true);
  dv.setFloat32(O.fuelLevel, p.fuelLevel, true);
  dv.setFloat32(O.fuelCapacity, p.fuelCapacity, true);
  dv.setFloat32(O.speedMps, p.speedMps, true);
  dv.setFloat32(O.boost, p.boost, true);
  dv.setFloat32(O.oilPressure, p.oilPressure, true);
  dv.setFloat32(O.waterTemp, p.waterTemp, true);
  dv.setFloat32(O.oilTemp, p.oilTemp, true);
  setWheels(dv, O.tyreTemp, p.tyreTemp);
  dv.setInt32(O.packetId, p.packetId | 0, true);
  dv.setInt16(O.lapCount, p.lapCount, true);
  dv.setInt16(O.totalLaps, p.totalLaps, true);
  dv.setInt32(O.bestLapMs, Math.round(p.bestLapMs), true);
  dv.setInt32(O.lastLapMs, Math.round(p.lastLapMs), true);
  dv.setInt32(O.timeOfDayMs, Math.round(p.timeOfDayMs), true);
  dv.setInt16(O.preRacePosition, p.preRacePosition, true);
  dv.setInt16(O.numCarsPreRace, p.numCarsPreRace, true);
  dv.setInt16(O.rpmAlertMin, p.rpmAlertMin, true);
  dv.setInt16(O.rpmAlertMax, p.rpmAlertMax, true);
  dv.setInt16(O.calculatedMaxSpeedKmh, p.calculatedMaxSpeedKmh, true);
  dv.setUint16(O.flags, p.flags & 0xffff, true);
  buf[O.gear] = ((p.suggestedGear & 0x0f) << 4) | (p.gear & 0x0f);
  buf[O.throttle] = u8(p.throttle);
  buf[O.brake] = u8(p.brake);
  setVec3(dv, O.roadPlane, p.roadPlane);
  dv.setFloat32(O.roadPlaneDistance, p.roadPlaneDistance, true);
  setWheels(dv, O.wheelRps, p.wheelRps);
  setWheels(dv, O.tyreRadius, p.tyreRadius);
  setWheels(dv, O.suspensionHeight, p.suspensionHeight);
  dv.setFloat32(O.clutchPedal, p.clutchPedal, true);
  dv.setFloat32(O.clutchEngagement, p.clutchEngagement, true);
  dv.setFloat32(O.rpmClutchToGearbox, p.rpmClutchToGearbox, true);
  dv.setFloat32(O.transmissionTopSpeed, p.transmissionTopSpeed, true);
  for (let i = 0; i < GEAR_RATIO_SLOTS; i++) {
    dv.setFloat32(O.gearRatios + i * 4, p.gearRatios[i] ?? 0, true);
  }
  dv.setInt32(O.carCode, p.carCode | 0, true);

  if (formatIncludes(format, 'B')) {
    dv.setFloat32(O.steeringAngle, p.steeringAngle ?? 0, true);
    dv.setFloat32(O.steeringAngularVelocity, p.steeringAngularVelocity ?? 0, true);
    dv.setFloat32(O.sway, p.sway ?? 0, true);
    dv.setFloat32(O.heave, p.heave ?? 0, true);
    dv.setFloat32(O.surge, p.surge ?? 0, true);
  }
  if (formatIncludes(format, '~')) {
    buf[O.throttleRaw] = u8(p.throttleRaw);
    buf[O.brakeRaw] = u8(p.brakeRaw);
    buf[O.unknown0x13E] = u8(p.unknown0x13E);
    buf[O.energyRecoveryFlag] = u8(p.energyRecoveryFlag);
    setWheels(dv, O.torqueVectoring, p.torqueVectoring);
    dv.setFloat32(O.energyRecovery, p.energyRecovery ?? 0, true);
    dv.setFloat32(O.unknown0x154, p.unknown0x154 ?? 0, true);
  }
  if (formatIncludes(format, 'C')) {
    setChars(buf, O.surfaceTypes, 4, p.surfaceTypes ?? 'TTTT');
    dv.setInt32(O.currentLapMs, Math.round(p.currentLapMs ?? 0), true);
    dv.setFloat32(O.wheelSteerAngle, p.wheelSteerAngle?.[0] ?? 0, true);
    dv.setFloat32(O.wheelSteerAngle + 4, p.wheelSteerAngle?.[1] ?? 0, true);
    dv.setFloat32(O.wheelbase, p.wheelbase ?? 0, true);
    setChars(buf, O.carCategory, 4, p.carCategory ?? '');
  }
  return buf;
}
