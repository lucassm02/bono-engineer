/** /api/status, /api/settings, /api/firewall, /api/lan. */

import { SETTINGS_KEYS } from '@gt7/core';
import {
  type ApiDiscoveryScanResult,
  type ApiSettings,
  type ApiStatus,
  DELTA_REFERENCE_KINDS,
  type DeltaReferenceKind,
  isPacketFormat,
  type LanInfo,
  type PacketFormat,
} from '@gt7/shared';
import type { FastifyInstance } from 'fastify';
import {
  badRequest,
  bodyObject,
  isIPv4,
  notFound,
  type Obj,
  optBoolean,
  optString,
} from '../http.ts';
import type { RouteContext } from './context.ts';

export function currentSettings(ctx: RouteContext): ApiSettings {
  const { runtime } = ctx;
  const s = runtime.getSettings();
  const ref = runtime.engine.deltaReference;
  return {
    consoleIp: s.consoleIp,
    consoleIpSource: s.consoleIpSource,
    liveFormat: s.liveFormat,
    liveFormatAuto: s.liveFormatAuto,
    captureFormat: s.captureFormat,
    record: s.record,
    autoCapture: s.autoCapture,
    deltaReference: { kind: ref.kind, lapId: ref.lapId },
    engineerAudioDeviceId: runtime.store.getSetting<string | null>(
      SETTINGS_KEYS.engineerAudioDeviceId,
      null,
    ),
  };
}

export function apiStatus(ctx: RouteContext): ApiStatus {
  return {
    ...ctx.hub.status(),
    consoleConnection: ctx.runtime.getConnection(),
    sessionCapture: ctx.runtime.getSessionCapture(),
    firewall: ctx.firewall.status,
    settings: currentSettings(ctx),
    running: ctx.runtime.running,
    httpPort: ctx.httpPort,
    tokenRequired: ctx.tokenRequired,
    simulator: ctx.simulator,
    telemetrySource: ctx.simulator ? 'demo' : 'gt7',
  };
}

function parseFormat(o: Obj, key: string, label: string): PacketFormat | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (!isPacketFormat(v)) throw badRequest(`O campo "${label}" deve ser A, B, ~ ou C.`);
  return v;
}

export function statusRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { runtime, hub } = ctx;

  app.get('/status', async () => apiStatus(ctx));

  app.get('/settings', async () => currentSettings(ctx));

  app.patch('/settings', async (req) => {
    const b = bodyObject(req.body);
    const known = [
      'consoleIp',
      'liveFormat',
      'liveFormatAuto',
      'captureFormat',
      'record',
      'autoCapture',
      'deltaReference',
      'engineerAudioDeviceId',
    ];
    const unknown = Object.keys(b).filter((k) => !known.includes(k));
    if (unknown.length) throw badRequest(`Campo(s) desconhecido(s): ${unknown.join(', ')}.`);

    // Validate everything first, then apply.
    // null (or an empty text) = forget the typed IP and go back to automatic discovery
    const clearIp =
      b.consoleIp === null || (typeof b.consoleIp === 'string' && !b.consoleIp.trim());
    const consoleIp = clearIp ? undefined : optString(b, 'consoleIp', 'consoleIp', 64)?.trim();
    if (consoleIp !== undefined && !isIPv4(consoleIp)) {
      throw badRequest('IP do console inválido (ex.: 192.168.0.20).');
    }
    const liveFormat = parseFormat(b, 'liveFormat', 'liveFormat');
    const liveFormatAuto = optBoolean(b, 'liveFormatAuto', 'liveFormatAuto');
    const captureFormat = parseFormat(b, 'captureFormat', 'captureFormat');
    const record = optBoolean(b, 'record', 'record');
    const autoCapture = optBoolean(b, 'autoCapture', 'autoCapture');
    const audioDevice =
      b.engineerAudioDeviceId === null
        ? null
        : optString(b, 'engineerAudioDeviceId', 'engineerAudioDeviceId', 160);
    if (audioDevice === '') throw badRequest('Informe um identificador de aparelho válido.');
    let ref: { kind: DeltaReferenceKind; lapId: string | null } | undefined;
    if (b.deltaReference !== undefined) {
      const r = bodyObject(b.deltaReference);
      if (!(DELTA_REFERENCE_KINDS as readonly unknown[]).includes(r.kind)) {
        throw badRequest('deltaReference.kind deve ser personalBest, sessionBest ou reference.');
      }
      const lapId = r.lapId === undefined || r.lapId === null ? null : r.lapId;
      if (lapId !== null && typeof lapId !== 'string') {
        throw badRequest('deltaReference.lapId deve ser um texto.');
      }
      if (lapId && !runtime.store.getLap(lapId))
        throw notFound('Volta de referência não encontrada.');
      ref = { kind: r.kind as DeltaReferenceKind, lapId };
    }

    if (clearIp) runtime.setConsoleIp(null);
    else if (consoleIp !== undefined) runtime.setConsoleIp(consoleIp);
    if (captureFormat !== undefined) runtime.setCaptureFormat(captureFormat);
    if (record !== undefined) runtime.setRecording(record);
    if (autoCapture !== undefined) runtime.setAutoCapture(autoCapture);
    if (ref) runtime.setDeltaReference(ref.kind, ref.lapId);
    if (audioDevice !== undefined)
      runtime.store.setSetting(SETTINGS_KEYS.engineerAudioDeviceId, audioDevice);
    const formatFailed = (e: Error) =>
      hub.notice({
        level: 'error',
        code: 'formatFailed',
        message: `Falha ao trocar o formato: ${e.message}`,
      });
    if (liveFormatAuto === true) {
      // Automatic mode wins over a format sent in the same request ("~" first, then B, then A).
      runtime.setLiveFormatAuto(true).catch(formatFailed);
    } else if (liveFormat !== undefined) {
      // Pins the format; applies after the ingestor cooldown (~15 s), progress goes out as notices/status.
      runtime.setPacketFormat(liveFormat).catch(formatFailed);
    } else if (liveFormatAuto === false) {
      runtime.setLiveFormatAuto(false).catch(formatFailed);
    }
    hub.scheduleStatus();
    return currentSettings(ctx);
  });

  // Forget the typed IP: back to automatic discovery.
  app.delete('/settings/consoleIp', async () => {
    runtime.setConsoleIp(null);
    hub.scheduleStatus();
    return currentSettings(ctx);
  });

  // Restart the search for the console (fast sweep again) and the automatic format round.
  app.post('/discovery/scan', async (): Promise<ApiDiscoveryScanResult> => {
    const started = runtime.rescan();
    hub.scheduleStatus();
    return { started, consoleConnection: runtime.getConnection() };
  });

  app.get('/firewall', async () => ctx.firewall.status);

  app.post('/firewall/check', async () => {
    const st = await ctx.firewall.check();
    hub.scheduleStatus();
    return st;
  });

  app.get('/lan', async (): Promise<LanInfo> => {
    const preferredUrl = ctx.lan.preferredUrl();
    return {
      port: ctx.httpPort,
      urls: ctx.lan.urls(),
      preferredUrl,
      localUrl: ctx.lan.localUrl(),
      qrSvgDataUrl: preferredUrl ? await ctx.lan.qrDataUrl(preferredUrl) : null,
    };
  });
}
