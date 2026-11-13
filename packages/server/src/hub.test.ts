import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompletedLap } from '@gt7/core';
import { Gt7Runtime } from '@gt7/core';
import { type LapCompletedEvent, type LiveFrame, WS_PROTOCOL_VERSION } from '@gt7/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type HubSocket, WsHub } from './hub.ts';

class FakeSocket extends EventEmitter implements HubSocket {
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  terminated = false;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }
  terminate(): void {
    this.terminated = true;
    this.close();
  }
  receive(msg: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(msg)), false);
  }
  types(): string[] {
    return this.sent.map((s) => (JSON.parse(s) as { type: string }).type);
  }
}

describe('WsHub', () => {
  let dir: string;
  let runtime: Gt7Runtime;
  let hub: WsHub;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gt7-hub-'));
    runtime = new Gt7Runtime({ dataDir: dir, record: false });
    hub = new WsHub(runtime, { serverVersion: 'test', keepAliveMs: 0 });
  });

  afterEach(async () => {
    hub.closeAll();
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const hello = (s: FakeSocket, deviceId: string) =>
    s.receive({ type: 'hello', protocolVersion: WS_PROTOCOL_VERSION, deviceId });

  it('drops frames for slow clients without queueing, and kills stuck ones', () => {
    const fast = new FakeSocket();
    const slow = new FakeSocket();
    const anon = new FakeSocket();
    hub.attach(fast);
    hub.attach(slow);
    hub.attach(anon); // never says hello: gets no frames
    hello(fast, 'fast');
    hello(slow, 'slow');
    expect(fast.types().slice(0, 3)).toEqual(['welcome', 'deviceProfile', 'status']);
    const slowBefore = slow.sent.length;

    slow.bufferedAmount = 100_000; // above the 32 KiB frame limit
    const frame = { t: 1, padding: 'x'.repeat(2000) } as unknown as LiveFrame;
    for (let i = 0; i < 1000; i++) runtime.emit('frame', frame);

    expect(fast.types().filter((t) => t === 'frame')).toHaveLength(1000);
    expect(slow.sent.length).toBe(slowBefore); // nothing queued for the slow client
    expect(anon.sent).toHaveLength(0);
    expect(hub.stats.framesDropped).toBe(1000);
    expect(hub.stats.framesSent).toBe(1000);

    // Important messages still reach a slow client...
    const ev = { lapId: 'x', lapNumber: 1, timeMs: 90_000 } as unknown as LapCompletedEvent;
    runtime.emit('lapCompleted', ev, {} as CompletedLap);
    expect(slow.types().at(-1)).toBe('lapCompleted');

    // ...unless its buffer is beyond the hard limit: then it is terminated.
    slow.bufferedAmount = 3 * 1024 * 1024;
    runtime.emit('lapCompleted', ev, {} as CompletedLap);
    expect(slow.terminated).toBe(true);
    expect(hub.stats.clients).toBe(2);
    expect(hub.stats.terminated).toBe(1);
    expect(fast.types().filter((t) => t === 'lapCompleted')).toHaveLength(2);
  });

  it('requires hello, validates messages and tracks devices/views', async () => {
    const s = new FakeSocket();
    hub.attach(s);
    s.receive({ type: 'currentView', view: 'tyres' });
    expect(JSON.parse(s.sent.at(-1)!)).toMatchObject({ type: 'notice', code: 'helloRequired' });
    s.receive({ type: 'hello', protocolVersion: WS_PROTOCOL_VERSION, deviceId: '../etc' });
    expect(JSON.parse(s.sent.at(-1)!)).toMatchObject({ code: 'badDeviceId' });
    s.receive({ type: 'hello', protocolVersion: 0, deviceId: 'phone-1', deviceName: 'Celular' });
    expect(s.types()).toContain('welcome');
    expect(s.sent.some((m) => m.includes('protocolMismatch'))).toBe(true);
    s.receive({ type: 'currentView', view: 'naoExiste' });
    expect(JSON.parse(s.sent.at(-1)!)).toMatchObject({ code: 'badMessage' });
    s.receive({ type: 'currentView', view: 'tyres' });
    expect(hub.devices()).toEqual([
      expect.objectContaining({ deviceId: 'phone-1', name: 'Celular', currentView: 'tyres' }),
    ]);
    s.receive({ type: 'setPacketFormat', format: 'Z' });
    expect(JSON.parse(s.sent.at(-1)!)).toMatchObject({ code: 'badMessage' });
    s.receive({ type: 'banana' });
    expect(JSON.parse(s.sent.at(-1)!)).toMatchObject({ code: 'unknownMessage' });
    s.receive({ type: 'setDeltaReference', kind: 'sessionBest' });
    expect(runtime.engine.deltaReference.kind).toBe('sessionBest');
    s.close();
    expect(hub.devices()).toEqual([]);
    expect(hub.deviceInfos(runtime.store.listDeviceProfiles())[0]).toMatchObject({
      deviceId: 'phone-1',
      online: false,
    });
  });
});
