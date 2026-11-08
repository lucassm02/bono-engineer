# @gt7/protocol

GT7 "Simulator Interface" over UDP: Salsa20 decrypt/encrypt, packet parse/encode (formats A, B, ~, C),
the `Gt7Ingestor` (socket + heartbeat + loss stats), `.gt7rec` session recordings and a fake console
(synthetic driver or recorded session) for developing without a PlayStation.

Protocol reference: [ESTUDO-TELEMETRIA-GT7.md](../../ESTUDO-TELEMETRIA-GT7.md).

## CLIs (run from the repo root)

### `npm run sim` — fake GT7 console

Listens for heartbeats on UDP 33739 and streams encrypted packets at 60 Hz to the sender on 33740,
honoring the heartbeat format ('A' | 'B' | '~' | 'C'). The first format is locked; it only changes
after the heartbeats pause for `--format-lock` ms (like the real console). Streaming stops after
`--heartbeat-timeout` ms without heartbeats.

```sh
npm run sim                                   # synthetic "pro" driver on the Synthetic Ring
npm run sim -- --profile amateur --seed 7     # amateur driver (brakes early, coasts, mistakes)
npm run sim -- --replay                       # mimic replay capture (smoothed inputs, no fuel use)
npm run sim -- --laps 5                       # restart the session (menu + out lap) every 5 laps
npm run sim -- --recording data/recordings/x.gt7rec   # replay a recording in real time (loops)
npm run sim -- --port 44739 --target-port 44740 --host 127.0.0.1
```

### `npm run sniff` — connect to a console and print one line per second

```sh
npm run sniff -- --ps-ip 192.168.0.50                 # real PS5 (format A)
npm run sniff -- --ps-ip 127.0.0.1 --format B         # against `npm run sim`
npm run sniff -- --ps-ip 192.168.0.50 --format '~' --record data/recordings/live.gt7rec
npm run sniff -- --discover                           # try broadcast discovery (network dependent)
```

Output: `speed rpm gear(suggested) throttle brake lap last best | format rate loss flags`.

On Windows allow inbound UDP 33740 in the firewall for a real console.

### `npm run gen-recording` — write a synthetic session to disk

```sh
npm run gen-recording -- --profile pro --laps 5 --seed 1 --format C
# -> data/recordings/synthetic-pro-s1.gt7rec
```

## Recording format (`.gt7rec`)

gzip stream: header `"GT7R" | u16 version | u8 format | u8 0 | f64 startTime | u32 metaLen | meta JSON`,
then records `u32 tMs | u16 len | decrypted packet`. Little-endian. The writer sync-flushes every second,
and the reader tolerates a truncated tail, so a crash loses at most about one second.

## Synthetic data

`generateLaps({ profile, laps, seed, format, replay })` returns `TelemetryPacket[]` at 60 Hz: an out lap,
then N laps on the 4.4 km "Synthetic Ring" (10 corners with known entry/apex/exit, see
`getSyntheticTrack().corners`). The output is deterministic for a given seed. The `pro` driver trail-brakes, and
the `amateur` driver brakes earlier, coasts, picks up the throttle later, varies from lap to lap and makes the
occasional mistake. Use the `pro` laps as the reference.
