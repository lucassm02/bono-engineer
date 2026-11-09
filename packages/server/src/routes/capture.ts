/** /api/capture: reference (replay) capture start/stop/status. */

import { isPacketFormat, type ReferenceCaptureStatus } from '@gt7/shared';
import type { FastifyInstance } from 'fastify';
import { badRequest, bodyObject, optBoolean, optNumber, optString, reqString } from '../http.ts';
import type { RouteContext } from './context.ts';

export function captureRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { runtime, hub } = ctx;
  const fail = (what: string) => (e: Error) =>
    hub.notice({ level: 'error', code: 'captureFailed', message: `${what}: ${e.message}` });

  app.get('/capture', async (): Promise<ReferenceCaptureStatus> => runtime.capture.status);

  /**
   * Arms a capture (Onda 9a) and answers 202 right away; progress (waiting for the replay, track,
   * start line, recording, validation) is pushed as `status` / `notice` over the WebSocket and is
   * in `GET /api/capture`. Body: `driverName` (required), optional `carName`, `notes`,
   * `rankingTimeMs` (validation), `expectedCarCode` and `trackId` (skips the identification of
   * the track from the replay's position; 400 if it does not exist). `format` is accepted but the
   * packet format is not changed any more.
   */
  app.post('/capture/start', async (req, reply) => {
    const b = bodyObject(req.body);
    const driverName = reqString(b, 'driverName', 'driverName', 80);
    const carName = optString(b, 'carName', 'carName', 80);
    const notes = optString(b, 'notes', 'notes', 500);
    const rankingTimeMs = optNumber(b, 'rankingTimeMs', 'rankingTimeMs', {
      min: 1,
      max: 3_600_000,
    });
    const expectedCarCode = optNumber(b, 'expectedCarCode', 'expectedCarCode', { integer: true });
    const trackId = optString(b, 'trackId', 'trackId', 80);
    if (trackId && !runtime.store.getTrack(trackId)) {
      throw badRequest('Pista não encontrada. Escolha uma pista que o app já conhece.');
    }
    if (b.format !== undefined && !isPacketFormat(b.format)) {
      throw badRequest('O campo "format" deve ser A, B, ~ ou C.');
    }
    // Explicit body format = one-off override; otherwise the runtime uses its persisted
    // capture format (runtime.setCaptureFormat / PATCH /api/settings).
    const format = isPacketFormat(b.format) ? b.format : undefined;
    runtime
      .startReferenceCapture({
        driverName,
        carName: carName ?? null,
        notes: notes ?? null,
        rankingTimeMs: rankingTimeMs ?? null,
        expectedCarCode: expectedCarCode ?? null,
        trackId: trackId || null,
        ...(format ? { format } : {}),
      })
      .catch(fail('Falha ao iniciar a captura'));
    return reply.code(202).send(runtime.capture.status);
  });

  /** Body `{ save?: boolean }` (default true; false discards the captured lap). */
  app.post('/capture/stop', async (req, reply) => {
    const b = req.body === undefined || req.body === null ? {} : bodyObject(req.body);
    const save = optBoolean(b, 'save', 'save') ?? true;
    runtime.stopReferenceCapture(save).catch(fail('Falha ao parar a captura'));
    return reply.code(202).send(runtime.capture.status);
  });
}
