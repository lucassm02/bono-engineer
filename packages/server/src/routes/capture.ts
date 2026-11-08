/** /api/capture: reference (replay) capture start/stop/status. */

import { SETTINGS_KEYS } from '@gt7/core';
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
   * Starts a capture. Answers 202 right away: switching the packet format waits for the ingestor
   * cooldown (~15 s); progress is pushed as `status` / `notice` over the WebSocket.
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
    if (b.format !== undefined && !isPacketFormat(b.format)) {
      throw badRequest('O campo "format" deve ser A, B, ~ ou C.');
    }
    const saved = runtime.store.getSetting<string>(SETTINGS_KEYS.captureFormat);
    const format = isPacketFormat(b.format) ? b.format : isPacketFormat(saved) ? saved : undefined;
    runtime
      .startReferenceCapture({
        driverName,
        carName: carName ?? null,
        notes: notes ?? null,
        rankingTimeMs: rankingTimeMs ?? null,
        expectedCarCode: expectedCarCode ?? null,
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
