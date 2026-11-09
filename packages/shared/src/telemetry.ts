/**
 * GT7 "Simulator Interface" telemetry contract (raw packet level).
 *
 * Source of truth for offsets: ESTUDO-TELEMETRIA-GT7.md §5. All multi-byte values are little-endian.
 * Owned by the protocol package (wave 1). Other packages consume these types read-only.
 */

/** Heartbeat character that selects the packet layout. */
export type PacketFormat = 'A' | 'B' | '~' | 'C';

export const PACKET_FORMATS: readonly PacketFormat[] = ['A', 'B', '~', 'C'] as const;

/** Datagram size in bytes per format (detect the format by length, not by the heartbeat sent). */
export const PACKET_SIZES: Readonly<Record<PacketFormat, number>> = {
  A: 0x128, // 296
  B: 0x13c, // 316
  '~': 0x158, // 344
  C: 0x170, // 368
};

/** Salsa20 nonce XOR constant per format. Note A ends in AF, B in EF. C is from a single source. */
export const PACKET_XOR_KEYS: Readonly<Record<PacketFormat, number>> = {
  A: 0xdeadbeaf,
  B: 0xdeadbeef,
  '~': 0x55fabb4f,
  C: 0xdeadbeef,
};

/** int32 LE at 0x00 after decryption ("0S7G"). */
export const TELEMETRY_MAGIC = 0x47375330;

/** UDP port on the console (heartbeat destination). */
export const GT7_CONSOLE_PORT = 33739;
/** UDP port on the app (where the console streams to). */
export const GT7_CLIENT_PORT = 33740;
/** Nominal packet rate of the console (one per physics frame). */
export const GT7_PACKET_RATE_HZ = 60;

/** Returns the format for a datagram length, or null if the size is unknown. */
export function formatFromLength(length: number): PacketFormat | null {
  switch (length) {
    case 0x128:
      return 'A';
    case 0x13c:
      return 'B';
    case 0x158:
      return '~';
    case 0x170:
      return 'C';
    default:
      return null;
  }
}

/** True if `f` is a valid packet format character. */
export function isPacketFormat(f: unknown): f is PacketFormat {
  return f === 'A' || f === 'B' || f === '~' || f === 'C';
}

/** True if format `have` contains every field of format `want` (formats are additive A ⊂ B ⊂ ~ ⊂ C). */
export function formatIncludes(have: PacketFormat, want: PacketFormat): boolean {
  return PACKET_SIZES[have] >= PACKET_SIZES[want];
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

/** Per-wheel values, always ordered FL, FR, RL, RR. */
export type Wheels<T = number> = [fl: T, fr: T, rl: T, rr: T];

export const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'] as const;
export type WheelName = (typeof WHEEL_NAMES)[number];

/**
 * Surface type character per wheel (packet C, less verified).
 * Community legends: T tarmac, C curb, D dirt, G grass, S sand, s snow. Unknown chars are kept as-is.
 */
export type SurfaceChar = 'T' | 'C' | 'D' | 'G' | 'S' | 's' | (string & {});

/** Value of the suggested-gear nibble meaning "no suggestion". */
export const SUGGESTED_GEAR_NONE = 15;

/**
 * One decoded telemetry packet. Base fields exist in every format (A); extended fields are present
 * only when the packet format includes them (B ⊂ ~ ⊂ C), otherwise `undefined`.
 *
 * Unknown/reserved regions (0xD4..0xF3, the IV seed at 0x40) are not represented.
 */
export interface TelemetryPacket {
  /** Layout this packet was decoded from (by datagram length). */
  format: PacketFormat;

  // ---- Packet A (0x00..0x127) ----
  /** 0x04 world position in meters. Y is up; the track plane is X/Z. */
  position: Vec3;
  /** 0x10 world velocity in m/s. */
  velocity: Vec3;
  /** 0x1C rotation, quaternion x/y/z components (PDTools reads it as quaternion). */
  rotation: Vec3;
  /** 0x28 orientation relative to north: 1.0 = north, 0.0 = south (quaternion w). */
  relativeOrientationToNorth: number;
  /** 0x2C angular velocity in rad/s (world axes). y is the yaw rate. */
  angularVelocity: Vec3;
  /** 0x38 body height in meters. */
  bodyHeight: number;
  /** 0x3C engine RPM. */
  engineRpm: number;
  /** 0x44 current fuel in liters (battery % for EVs). */
  fuelLevel: number;
  /** 0x48 fuel capacity in liters (100 for EVs; 0 when the event has no fuel consumption). */
  fuelCapacity: number;
  /** 0x4C speed in m/s (× 3.6 = km/h). */
  speedMps: number;
  /** 0x50 turbo boost raw value; bar = value − 1 (1.0 = 0 kPa). */
  boost: number;
  /** 0x54 oil pressure in bar. */
  oilPressure: number;
  /** 0x58 water temperature °C (the game always sends 85). */
  waterTemp: number;
  /** 0x5C oil temperature °C (the game always sends 110). */
  oilTemp: number;
  /** 0x60 tyre surface temperature °C, FL/FR/RL/RR. */
  tyreTemp: Wheels;
  /** 0x70 packet id, increments every packet. Use it for loss/duplicate detection. */
  packetId: number;
  /** 0x74 current lap (0 before crossing the start line). */
  lapCount: number;
  /** 0x76 total laps of the event (0 in time trial / free run). */
  totalLaps: number;
  /** 0x78 best lap time in ms; −1 if none. */
  bestLapMs: number;
  /** 0x7C last lap time in ms; −1 if none. */
  lastLapMs: number;
  /** 0x80 in-game time of day in ms. */
  timeOfDayMs: number;
  /** 0x84 grid/qualifying position before the race; −1 after the start. */
  preRacePosition: number;
  /** 0x86 number of cars before the race; −1 after the start. */
  numCarsPreRace: number;
  /** 0x88 shift-light alert RPM, lower bound. */
  rpmAlertMin: number;
  /** 0x8A shift-light alert RPM, upper bound. */
  rpmAlertMax: number;
  /** 0x8C calculated max speed in km/h. */
  calculatedMaxSpeedKmh: number;
  /** 0x8E simulator flags bitfield, see {@link SimulatorFlags}. */
  flags: number;
  /**
   * 0x90 low nibble: current gear. 0 is presumed to be neutral/reverse (encoding not documented,
   * see study §9.3).
   */
  gear: number;
  /** 0x90 high nibble: suggested gear; {@link SUGGESTED_GEAR_NONE} (15) = no suggestion. */
  suggestedGear: number;
  /** 0x91 throttle 0–255, after aids/TCS. */
  throttle: number;
  /** 0x92 brake 0–255. */
  brake: number;
  /** 0x94 road plane normal vector. */
  roadPlane: Vec3;
  /** 0xA0 distance to the road plane. */
  roadPlaneDistance: number;
  /** 0xA4 wheel rotation speed in rad/s, FL..RR. Signed: always use Math.abs. */
  wheelRps: Wheels;
  /** 0xB4 tyre radius in meters, FL..RR. */
  tyreRadius: Wheels;
  /** 0xC4 suspension height in meters, FL..RR. */
  suspensionHeight: Wheels;
  /** 0xF4 clutch pedal 0–1. */
  clutchPedal: number;
  /** 0xF8 clutch engagement 0–1. */
  clutchEngagement: number;
  /** 0xFC RPM from clutch to gearbox. */
  rpmClutchToGearbox: number;
  /** 0x100 transmission top speed (as a ratio). */
  transmissionTopSpeed: number;
  /**
   * 0x104 gear ratios 1st..8th (8 entries). Index 7 comes from 0x120, which PDTools ignores and
   * MacManley reads as 8th gear; 0 when unused.
   */
  gearRatios: number[];
  /** 0x124 car code (car id); map with a community car table to get the name. */
  carCode: number;

  // ---- Packet B extras (0x128..0x13B) ----
  /** 0x128 steering wheel angle in rad (sign convention unverified; synthetic: + = left). */
  steeringAngle?: number;
  /** 0x12C steering angular velocity in rad/s. */
  steeringAngularVelocity?: number;
  /** 0x130 sway, lateral acceleration in m/s², + = RIGHT (verified on a real PS5 session). */
  sway?: number;
  /** 0x134 heave, vertical acceleration in m/s² (unit verified; sign unverified). */
  heave?: number;
  /** 0x138 surge, longitudinal acceleration in m/s², + = forward (verified). */
  surge?: number;

  // ---- Packet ~ extras (0x13C..0x157) ----
  /** 0x13C raw driver throttle 0–255 (before filters). Community interpretation. */
  throttleRaw?: number;
  /** 0x13D actuated brake 0–255 (live sessions only). */
  brakeRaw?: number;
  /** 0x13E unknown byte (0/2/4/9 depending on the car). */
  unknown0x13E?: number;
  /** 0x13F "no fuel consumption" / energy recovery flag, 0 or 1. */
  energyRecoveryFlag?: number;
  /** 0x140 torque vectoring per wheel FL..RR (some cars only). */
  torqueVectoring?: Wheels;
  /** 0x150 energy recovery (battery), hybrids/EVs. */
  energyRecovery?: number;
  /** 0x154 unknown float. */
  unknown0x154?: number;

  // ---- Packet C extras (0x158..0x16F), less verified ----
  /** 0x158 surface type char per wheel FL..RR. */
  surfaceTypes?: Wheels<SurfaceChar>;
  /** 0x15C current lap time in ms. */
  currentLapMs?: number;
  /** 0x160 front wheels steering angle (2 floats, presumably FL, FR) in rad. */
  wheelSteerAngle?: [number, number];
  /** 0x168 wheelbase in meters. */
  wheelbase?: number;
  /** 0x16C car category, 4 ASCII chars (NULs trimmed). */
  carCategory?: string;
}

/** Bit masks of the flags int16 at 0x8E. */
export const SimulatorFlags = {
  CarOnTrack: 1 << 0,
  Paused: 1 << 1,
  LoadingOrProcessing: 1 << 2,
  InGear: 1 << 3,
  HasTurbo: 1 << 4,
  RevLimiterAlert: 1 << 5,
  HandBrake: 1 << 6,
  Lights: 1 << 7,
  HighBeam: 1 << 8,
  LowBeam: 1 << 9,
  AsmActive: 1 << 10,
  TcsActive: 1 << 11,
} as const;

export type SimulatorFlagName = keyof typeof SimulatorFlags;

/** Flags decoded to booleans (same names as {@link SimulatorFlags}, camelCase). */
export interface DecodedFlags {
  carOnTrack: boolean;
  paused: boolean;
  loadingOrProcessing: boolean;
  inGear: boolean;
  hasTurbo: boolean;
  revLimiterAlert: boolean;
  handBrake: boolean;
  lights: boolean;
  highBeam: boolean;
  lowBeam: boolean;
  asmActive: boolean;
  tcsActive: boolean;
}

/** True if every bit of `flag` is set in `flags`. */
export function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) === flag;
}

export function decodeFlags(flags: number): DecodedFlags {
  return {
    carOnTrack: hasFlag(flags, SimulatorFlags.CarOnTrack),
    paused: hasFlag(flags, SimulatorFlags.Paused),
    loadingOrProcessing: hasFlag(flags, SimulatorFlags.LoadingOrProcessing),
    inGear: hasFlag(flags, SimulatorFlags.InGear),
    hasTurbo: hasFlag(flags, SimulatorFlags.HasTurbo),
    revLimiterAlert: hasFlag(flags, SimulatorFlags.RevLimiterAlert),
    handBrake: hasFlag(flags, SimulatorFlags.HandBrake),
    lights: hasFlag(flags, SimulatorFlags.Lights),
    highBeam: hasFlag(flags, SimulatorFlags.HighBeam),
    lowBeam: hasFlag(flags, SimulatorFlags.LowBeam),
    asmActive: hasFlag(flags, SimulatorFlags.AsmActive),
    tcsActive: hasFlag(flags, SimulatorFlags.TcsActive),
  };
}

export function encodeFlags(d: Partial<DecodedFlags>): number {
  let f = 0;
  if (d.carOnTrack) f |= SimulatorFlags.CarOnTrack;
  if (d.paused) f |= SimulatorFlags.Paused;
  if (d.loadingOrProcessing) f |= SimulatorFlags.LoadingOrProcessing;
  if (d.inGear) f |= SimulatorFlags.InGear;
  if (d.hasTurbo) f |= SimulatorFlags.HasTurbo;
  if (d.revLimiterAlert) f |= SimulatorFlags.RevLimiterAlert;
  if (d.handBrake) f |= SimulatorFlags.HandBrake;
  if (d.lights) f |= SimulatorFlags.Lights;
  if (d.highBeam) f |= SimulatorFlags.HighBeam;
  if (d.lowBeam) f |= SimulatorFlags.LowBeam;
  if (d.asmActive) f |= SimulatorFlags.AsmActive;
  if (d.tcsActive) f |= SimulatorFlags.TcsActive;
  return f;
}

/** Decodes the gear byte at 0x90. `suggested` is null when the nibble is 15 (no suggestion). */
export function decodeGearByte(byte: number): { gear: number; suggested: number | null } {
  const gear = byte & 0x0f;
  const s = (byte >> 4) & 0x0f;
  return { gear, suggested: s === SUGGESTED_GEAR_NONE ? null : s };
}

/** Builds the gear byte at 0x90. A null suggestion is encoded as 15. */
export function encodeGearByte(gear: number, suggested: number | null): number {
  const s = suggested === null ? SUGGESTED_GEAR_NONE : suggested;
  return ((s & 0x0f) << 4) | (gear & 0x0f);
}

/** Suggested gear of a packet, or null when the game gives no suggestion. */
export function suggestedGearOf(p: Pick<TelemetryPacket, 'suggestedGear'>): number | null {
  return p.suggestedGear === SUGGESTED_GEAR_NONE ? null : p.suggestedGear;
}

export const MPS_TO_KMH = 3.6;
export const MPS_TO_MPH = 2.236936;

export function mpsToKmh(mps: number): number {
  return mps * MPS_TO_KMH;
}

/** Boost in bar (raw value − 1). */
export function boostBar(raw: number): number {
  return raw - 1;
}

/** Pedal byte (0–255) to 0–1. */
export function pedalToUnit(byte: number): number {
  return byte / 255;
}

/**
 * Slip ratio per wheel: (|rps| × radius) / speed − 1. > 0 spinning (traction), < 0 locking (braking).
 * Returns 0 below `minSpeedMps` to avoid division noise at standstill.
 */
export function wheelSlipRatios(
  p: Pick<TelemetryPacket, 'wheelRps' | 'tyreRadius' | 'speedMps'>,
  minSpeedMps = 2,
): Wheels {
  const v = p.speedMps;
  if (v < minSpeedMps) return [0, 0, 0, 0];
  const r = (i: 0 | 1 | 2 | 3) => (Math.abs(p.wheelRps[i]) * p.tyreRadius[i]) / v - 1;
  return [r(0), r(1), r(2), r(3)];
}

/** True when the car is driving: on track, not paused, not loading. */
export function isDriving(flags: number): boolean {
  return (
    hasFlag(flags, SimulatorFlags.CarOnTrack) &&
    !hasFlag(flags, SimulatorFlags.Paused) &&
    !hasFlag(flags, SimulatorFlags.LoadingOrProcessing)
  );
}

// ---------------------------------------------------------------------------------------------
// Ingestor status (UDP link level), produced by @gt7/protocol Gt7Ingestor.
// ---------------------------------------------------------------------------------------------

/**
 * Link state of the UDP ingestor.
 * - stopped: socket closed.
 * - connecting: heartbeats being sent, no valid packet received yet.
 * - connected: valid packets arriving.
 * - timeout: packets were arriving but none for `timeoutMs` (heartbeats continue).
 * - switchingFormat: heartbeats paused to let the console release the format lock.
 */
export type IngestorState = 'stopped' | 'connecting' | 'connected' | 'timeout' | 'switchingFormat';

/** Rolling link statistics, emitted ~1 Hz by the ingestor. */
export interface IngestorStats {
  state: IngestorState;
  /** Heartbeat format currently requested. */
  format: PacketFormat;
  /** Format of the last valid packet received (by length), null if none yet. */
  receivedFormat: PacketFormat | null;
  /** Console address packets are coming from / heartbeats go to. */
  consoleAddress: string | null;
  /** Valid packets per second over the last window. */
  rateHz: number;
  /** Total valid packets since start. */
  received: number;
  /** Total packets missing according to packetId gaps. */
  lost: number;
  /** Packet loss % over the last window (0–100). */
  lossPct: number;
  /** Duplicated or out-of-order packetIds dropped. */
  duplicates: number;
  /** Datagrams with known size that failed magic validation. */
  decryptFailures: number;
  /** Datagrams with an unknown size. */
  invalidSize: number;
  /** packetId resets detected (e.g. game restarted the stream). */
  resets: number;
  /** Epoch ms of the last valid packet, null if none yet. */
  lastPacketAt: number | null;
  /** Heartbeats sent since start. */
  heartbeatsSent: number;
}
