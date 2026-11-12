/**
 * /api/data/*: where the data lives, a full backup (.bono) and its import.
 *
 *   GET  /api/data/summary                  folder, sizes and counts
 *   GET  /api/data/export?laps=&settings=&recordings=   downloads a .bono backup
 *   POST /api/data/import                   raw body (application/octet-stream): stores the upload
 *                                           and answers with what is inside
 *   POST /api/data/import/:id/apply         `{ mode: 'merge' | 'replace', settings: boolean }`
 *   DELETE /api/data/import/:id             discards an upload
 *
 * A backup never carries secrets (AI key, tokens). Importing is refused while a session is open.
 */

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  BACKUP_EXTENSION,
  createBackup,
  detectCloudFolder,
  type ImportMode,
  importBackup,
  inspectBackup,
} from '@gt7/core';
import { PRODUCT_NAME } from '@gt7/shared';
import type { FastifyInstance } from 'fastify';
import { badRequest, bodyObject, conflict, isSafeId, notFound, optBoolean } from '../http.ts';
import type { RouteContext } from './context.ts';

const MAX_UPLOAD = 4 * 1024 ** 3;
const UPLOAD_TTL_MS = 60 * 60_000;

function dirSize(dir: string): number {
  let total = 0;
  if (!existsSync(dir)) return 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    try {
      total += name.isDirectory() ? dirSize(p) : statSync(p).size;
    } catch {
      // vanished while counting
    }
  }
  return total;
}

function uploadsDir(): string {
  const dir = join(tmpdir(), 'bono-imports');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function purgeOldUploads(): void {
  const dir = uploadsDir();
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    try {
      if (Date.now() - statSync(p).mtimeMs > UPLOAD_TTL_MS) rmSync(p, { force: true });
    } catch {
      // ignore
    }
  }
}

const flag = (v: unknown, fallback: boolean): boolean =>
  v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : fallback;

export function dataRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { runtime } = ctx;
  const meta = () => ({ appName: PRODUCT_NAME, appVersion: ctx.serverVersion });

  app.get('/data/summary', async () => {
    const store = runtime.store;
    const count = (sql: string) => (store.db.prepare(sql).get() as { c: number }).c;
    return {
      dataDir: store.dataDir,
      cloudProvider: detectCloudFolder(store.dataDir)?.provider ?? null,
      sizes: {
        databaseBytes: existsSync(store.dbPath) ? statSync(store.dbPath).size : 0,
        tracesBytes: dirSize(store.tracesDir),
        recordingsBytes: dirSize(store.recordingsDir),
      },
      counts: {
        sessions: count('SELECT count(*) AS c FROM sessions'),
        laps: count('SELECT count(*) AS c FROM laps'),
        tracks: count('SELECT count(*) AS c FROM tracks'),
        recordings: count('SELECT count(*) AS c FROM sessions WHERE recording_file IS NOT NULL'),
      },
      simulator: ctx.simulator,
    };
  });

  app.get('/data/export', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const options = {
      laps: flag(q.laps, true),
      settings: flag(q.settings, true),
      recordings: flag(q.recordings, false),
    };
    if (!options.laps && !options.settings) {
      throw badRequest('Escolha o que exportar: voltas, configurações ou os dois.');
    }
    const dir = uploadsDir();
    const file = join(
      dir,
      `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${BACKUP_EXTENSION}`,
    );
    const info = await createBackup(runtime.store, options, file, meta());
    const day = new Date(info.manifest.createdAt).toISOString().slice(0, 10);
    const kind = options.laps ? 'backup' : 'configuracoes';
    const stream = createReadStream(file);
    const cleanup = () => rmSync(file, { force: true });
    stream.on('close', cleanup);
    reply.raw.on('close', cleanup);
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-length', String(info.sizeBytes))
      .header(
        'content-disposition',
        `attachment; filename="Bono-${kind}-${day}${BACKUP_EXTENSION}"`,
      )
      .send(stream);
  });

  // The upload is the raw file: the parser hands the stream over untouched.
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) =>
    done(null, payload),
  );

  app.post('/data/import', { bodyLimit: MAX_UPLOAD }, async (req) => {
    purgeOldUploads();
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const file = join(uploadsDir(), `${id}${BACKUP_EXTENSION}`);
    const body = req.body as NodeJS.ReadableStream | undefined;
    if (!body || typeof (body as { pipe?: unknown }).pipe !== 'function') {
      throw badRequest('Envie o arquivo de backup como conteúdo binário.');
    }
    try {
      await pipeline(body, createWriteStream(file));
      const info = await inspectBackup(file);
      return { uploadId: id, manifest: info.manifest, sizeBytes: info.sizeBytes };
    } catch (e) {
      rmSync(file, { force: true });
      throw badRequest((e as Error).message, 'invalidBackup');
    }
  });

  app.post('/data/import/:id/apply', async (req) => {
    const { id } = req.params as { id: string };
    if (!isSafeId(id)) throw badRequest('Identificador de envio inválido.');
    const file = join(uploadsDir(), `${id}${BACKUP_EXTENSION}`);
    if (!existsSync(file)) throw notFound('O envio expirou. Escolha o arquivo de novo.');
    const b = bodyObject(req.body);
    const mode = b.mode === 'replace' ? 'replace' : b.mode === 'merge' ? 'merge' : null;
    if (!mode) throw badRequest('Informe o modo: "merge" ou "replace".');
    const settings = optBoolean(b, 'settings', 'settings') ?? false;
    // Adding is safe while a session is being recorded (it only inserts what is missing);
    // replacing would pull the data from under the session.
    if (mode === 'replace' && runtime.session) {
      throw conflict(
        'Há uma sessão ao vivo em andamento. Saia da pista e espere a sessão fechar para substituir tudo. Somar ao histórico funciona a qualquer momento.',
        'sessionActive',
      );
    }
    try {
      const result = await importBackup(
        runtime.store,
        file,
        { mode: mode as ImportMode, settings },
        meta(),
      );
      for (const t of runtime.store.listTracks()) runtime.analysis.invalidateTrack(t.id);
      runtime.refreshTrack();
      rmSync(file, { force: true });
      return result;
    } catch (e) {
      throw badRequest(`Não foi possível importar: ${(e as Error).message}`, 'importFailed');
    }
  });

  app.delete('/data/import/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (isSafeId(id)) rmSync(join(uploadsDir(), `${id}${BACKUP_EXTENSION}`), { force: true });
    return reply.code(204).send();
  });
}
