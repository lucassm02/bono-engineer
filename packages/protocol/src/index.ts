/**
 * @gt7/protocol — GT7 Simulator Interface: Salsa20 crypto, packet parse/encode, UDP ingestor,
 * session recordings and a fake console (synthetic or recorded data) for development.
 */

export {
  buildNonce,
  type DecryptOptions,
  type DecryptResult,
  decryptPacket,
  encryptPacket,
  GT7_KEY,
  hasValidMagic,
  IV_SEED_OFFSET,
  readSeed,
  salsaXor,
} from './crypto.ts';
export {
  type ArpEntry,
  type ArpReader,
  ConsoleDiscovery,
  type ConsoleDiscoveryEvents,
  type ConsoleDiscoveryOptions,
  type DiscoveryInfo,
  intToIp,
  ipToInt,
  isLoopbackIPv4,
  isPrivateIPv4,
  isSonyMac,
  type OrderHints,
  orderScanHosts,
  PLAYSTATION_OUIS,
  type PlanScanOptions,
  parseArpTable,
  planScanSubnets,
  prefixLength,
  readArpTable,
  type ScanSubnet,
  toBatches,
} from './discovery.ts';
export { encodePacket } from './encode.ts';
export {
  Gt7Ingestor,
  type Gt7IngestorEvents,
  type Gt7IngestorOptions,
  type IngestedPacket,
  localBroadcastAddresses,
} from './ingestor.ts';
export { GEAR_RATIO_SLOTS, OFFSETS } from './layout.ts';
export { PacketParseError, parsePacket, tryParsePacket } from './parse.ts';
export {
  loadRecording,
  RECORDING_EXTENSION,
  RECORDING_MAGIC,
  RECORDING_VERSION,
  type RecordingHeader,
  type RecordingMeta,
  RecordingReader,
  type RecordingRecord,
  RecordingWriter,
  type RecordingWriterOptions,
} from './recording.ts';
export {
  FakeConsole,
  type FakeConsoleEvents,
  type FakeConsoleOptions,
  type FakeConsoleSource,
} from './simulator/fake-console.ts';
export * from './simulator/synthetic/index.ts';
