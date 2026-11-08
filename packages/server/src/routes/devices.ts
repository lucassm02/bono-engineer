/** /api/devices: per-device dashboard profiles + remote "show view". */

import { type DeviceInfo, isViewId, normalizeDeviceProfile } from '@gt7/shared';
import type { FastifyInstance } from 'fastify';
import { badRequest, bodyObject, conflict, notFound, type Obj, optString } from '../http.ts';
import type { RouteContext } from './context.ts';

const DEVICE_ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;

function deviceId(params: unknown): string {
  const v = (params as Obj).id;
  if (typeof v !== 'string' || !DEVICE_ID_RE.test(v)) throw badRequest('deviceId inválido.');
  return v;
}

export function deviceRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { hub } = ctx;
  const store = ctx.runtime.store;

  app.get(
    '/devices',
    async (): Promise<DeviceInfo[]> => hub.deviceInfos(store.listDeviceProfiles()),
  );

  app.get('/devices/:id', async (req): Promise<DeviceInfo> => {
    const id = deviceId(req.params);
    const info = hub.deviceInfo(id, store.getDeviceProfile(id));
    if (!info.profile && !info.online && info.lastSeenAt === null) {
      throw notFound('Dispositivo não encontrado.');
    }
    return info;
  });

  /** Replaces the profile (server edit = newest) and pushes it to the device. */
  app.put('/devices/:id', async (req) => {
    const id = deviceId(req.params);
    const b = bodyObject(req.body);
    const profile = normalizeDeviceProfile({ ...b, deviceId: id }, id);
    const saved = store.saveDeviceProfile({ ...profile, deviceId: id, updatedAt: Date.now() });
    hub.profileUpdated(saved);
    return saved;
  });

  app.delete('/devices/:id', async (req) => {
    const id = deviceId(req.params);
    if (!store.deleteDeviceProfile(id)) throw notFound('Dispositivo não encontrado.');
    return { ok: true, deviceId: id };
  });

  /** Remote control: body `{ view, from? }`. */
  app.post('/devices/:id/show-view', async (req) => {
    const id = deviceId(req.params);
    const b = bodyObject(req.body);
    if (!isViewId(b.view)) throw badRequest('Tela desconhecida.');
    const from = optString(b, 'from', 'from', 100) ?? 'api';
    const delivered = hub.showView(id, b.view, from);
    if (delivered === 0) throw conflict('O dispositivo não está conectado.', 'deviceOffline');
    return { ok: true, delivered };
  });
}
