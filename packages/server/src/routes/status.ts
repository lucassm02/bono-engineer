/** /api/status, /api/settings, /api/firewall, /api/lan. */

import { SETTINGS_KEYS } from '@gt7/core';
import {
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
  const cap = runtime.store.getSetting<string>(SETTINGS_KEYS.captureFormat);
  const ref = runtime.engine.deltaReference;
  return {
    consoleIp: s.consoleIp,
    liveFormat: s.liveFormat,
    captureFormat: isPacketFormat(cap) ? cap : s.captureFormat,
    record: s.record,
    deltaReference: { kind: ref.kind, lapId: ref.lapId },
  };
}

export function apiStatus(ctx: RouteContext): ApiStatus {
  return {
    ...ctx.hub.status(),
    firewall: ctx.firewall.status,
    settings: currentSettings(ctx),
    running: ctx.runtime.running,
    httpPort: ctx.httpPort,
    tokenRequired: ctx.tokenRequired,
    simulator: ctx.simulator,
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
    const known = ['consoleIp', 'liveFormat', 'captureFormat', 'record', 'deltaReference'];
    const unknown = Object.keys(b).filter((k) => !known.includes(k));
    if (unknown.length) throw badRequest(`Campo(s) desconhecido(s): ${unknown.join(', ')}.`);

    // Validate everything first, then apply.
    const consoleIp = optString(b, 'consoleIp', 'consoleIp', 64)?.trim();
    if (consoleIp !== undefined && !isIPv4(consoleIp)) {
      throw badRequest('IP do console inválido (ex.: 192.168.0.20).');
    }
    const liveFormat = parseFormat(b, 'liveFormat', 'liveFormat');
    const captureFormat = parseFormat(b, 'captureFormat', 'captureFormat');
    const record = optBoolean(b, 'record', 'record');
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

    if (consoleIp !== undefined) runtime.setConsoleIp(consoleIp);
    if (captureFormat !== undefined) {
      runtime.store.setSetting(SETTINGS_KEYS.captureFormat, captureFormat);
    }
    if (record !== undefined) runtime.setRecording(record);
    if (ref) runtime.setDeltaReference(ref.kind, ref.lapId);
    if (liveFormat !== undefined) {
      // Applies after the ingestor cooldown (~15 s); progress goes out as notices/status.
      runtime.setPacketFormat(liveFormat).catch((e: Error) =>
        hub.notice({
          level: 'error',
          code: 'formatFailed',
          message: `Falha ao trocar o formato: ${e.message}`,
        }),
      );
    }
    hub.scheduleStatus();
    return currentSettings(ctx);
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
