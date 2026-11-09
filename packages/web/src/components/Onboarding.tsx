/**
 * First-run assistant (3 short steps, nothing technical):
 *  1. open Gran Turismo 7 on a track while the app looks for the PS5 (live status),
 *  2. "PS5 encontrado ✓" + the QR code to race from the phone,
 *  3. all set → live dashboard.
 * Can be skipped at any time. After ~40 s without finding the console it offers a help checklist.
 */

import type { ApiStatus } from '@gt7/shared';
import { useEffect, useState } from 'react';
import { api } from '../analysis/api.ts';
import { copyText } from '../analysis/components/ui.tsx';
import { agoText, describeLink, hostsProbedText, ipSourceLabel } from '../lib/consoleLink.ts';
import { GT7_INTEGRATION } from '../lib/integrations.ts';
import {
  HELP_AFTER_MS,
  needsHelp,
  nextStep,
  ONBOARDING_KEY,
  ONBOARDING_STEPS,
  type OnboardingStep,
} from '../lib/onboarding.ts';
import { navigate, routes } from '../lib/route.ts';
import { saveString } from '../lib/storage.ts';
import { rescanConsole } from '../net/consoleActions.ts';
import { useConsoleConnection } from '../state/consoleLink.ts';
import { useUi } from '../state/uiStore.ts';
import { IpForm, LinkDot } from './ConsoleLink.tsx';

/** Ends the assistant (finished or skipped): it will not come back on its own. */
export function finishOnboarding(goLive: boolean): void {
  saveString(ONBOARDING_KEY, '1');
  useUi.setState({ onboarding: 'off' });
  if (goLive) navigate(routes.live());
}

function Radar({ found }: { found: boolean }) {
  return (
    <div className="ob-radar" data-found={found ? '1' : '0'} aria-hidden="true">
      <span className="ob-ring" />
      <span className="ob-ring" />
      <span className="ob-ring" />
      <svg viewBox="0 0 64 64" className="ob-radar-core" aria-hidden="true">
        {found ? (
          <path
            d="M18 33l10 10 18-22"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="ob-check"
          />
        ) : (
          <>
            <rect
              x="22"
              y="12"
              width="20"
              height="40"
              rx="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              d="M32 18v28"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              opacity=".5"
            />
          </>
        )}
      </svg>
    </div>
  );
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function HelpChecklist({ status }: { status: ApiStatus | null }) {
  const [showIp, setShowIp] = useState(false);
  const fw = status?.firewall;
  return (
    <section className="ob-help" aria-label="Ajuda para achar o PS5">
      <h3>Ainda não achei o PS5. Vamos conferir:</h3>
      <ul>
        <li>
          <strong>PS5 ligado e na mesma rede.</strong> Ele precisa estar no mesmo Wi-Fi (ou no mesmo
          roteador) que este PC. Evite a rede “convidado”.
        </li>
        <li>
          <strong>Gran Turismo 7 aberto numa pista.</strong> No menu o PS5 não envia dados. Entre
          num Time Trial, treino livre ou replay.
        </li>
        <li>
          <strong>Firewall do Windows.</strong>{' '}
          {!fw ? (
            'Verificando…'
          ) : fw.state === 'ok' ? (
            'Tudo liberado ✓'
          ) : (
            <>
              {fw.message}
              {fw.powershellCommands.length > 0 && (
                <>
                  <pre className="ob-code">{fw.powershellCommands.join('\n')}</pre>
                  <button
                    type="button"
                    className="cx-btn cx-btn-ghost cx-btn-sm"
                    onClick={() => void copyText(fw.powershellCommands.join('\n'))}
                  >
                    Copiar comandos
                  </button>
                </>
              )}
            </>
          )}
        </li>
        <li>
          <strong>Nenhum outro programa de telemetria aberto</strong> (SimHub, GT7 Dashboard…): só
          um deles pode falar com o PS5 por vez.
        </li>
      </ul>
      <div className="cx-actions">
        <button type="button" className="cx-btn" onClick={() => void rescanConsole()}>
          Procurar de novo
        </button>
        <button type="button" className="cx-btn cx-btn-ghost" onClick={() => setShowIp((v) => !v)}>
          Último recurso: informar o IP
        </button>
      </div>
      {showIp && <IpForm autoFocus />}
    </section>
  );
}

function SearchStep({ startedAt }: { startedAt: number }) {
  const conn = useConsoleConnection();
  const view = describeLink(conn);
  const now = useNow(1000);
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const elapsed = now - startedAt;
  const help = needsHelp('search', elapsed, conn?.state ?? null);
  useEffect(() => {
    if (!help) return;
    let alive = true;
    const load = () =>
      api
        .status()
        .then((s) => alive && setStatus(s))
        .catch(() => {});
    void load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [help]);
  return (
    <>
      <Radar found={false} />
      <h1>Conecte o {GT7_INTEGRATION.name}</h1>
      <p className="ob-lead">
        No PS5, <strong>abra o Gran Turismo 7 e entre em uma pista</strong> (ou num replay). O resto
        é comigo.
      </p>
      <div className="ob-live" data-tone={view.tone} role="status" aria-live="polite">
        <LinkDot tone={view.tone} busy={view.busy} />
        <div>
          <strong>{view.title}</strong>
          {conn && conn.state === 'searching' && (
            <span className="ob-live-sub">
              {conn.hostsProbed > 0 ? `${hostsProbedText(conn.hostsProbed)} · ` : ''}
              {agoText(conn.lastScanAt) === 'nunca'
                ? 'começando…'
                : `varredura ${agoText(conn.lastScanAt)}`}
            </span>
          )}
        </div>
      </div>
      <div className="ob-progress" aria-hidden="true">
        <span />
      </div>
      {!help && (
        <p className="ob-hint dim">
          Pode levar alguns segundos. Se demorar mais de {Math.round(HELP_AFTER_MS / 1000)} s, eu
          mostro o que conferir.
        </p>
      )}
      {help && <HelpChecklist status={status} />}
    </>
  );
}

function FoundStep({ onNext }: { onNext: () => void }) {
  const conn = useConsoleConnection();
  const view = describeLink(conn);
  const [lan, setLan] = useState<{ url: string | null; qr: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .lan()
      .then((l) => alive && setLan({ url: l.urls[0] ?? l.preferredUrl, qr: l.qrSvgDataUrl }))
      .catch(() => alive && setLan({ url: null, qr: null }));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <Radar found />
      <h1>PS5 encontrado ✓</h1>
      <p className="ob-lead">
        {conn?.consoleIp ? (
          <>
            Console em <span className="num">{conn.consoleIp}</span> ({ipSourceLabel(conn.source)}).
          </>
        ) : (
          'Console encontrado.'
        )}{' '}
        {conn?.state === 'receiving'
          ? 'Os dados já estão chegando.'
          : 'Assim que você entrar numa pista, os dados começam a chegar.'}
      </p>
      <div className="ob-live" data-tone={view.tone} role="status" aria-live="polite">
        <LinkDot tone={view.tone} busy={view.busy} />
        <div>
          <strong>{conn?.state === 'found' ? 'Aguardando o jogo' : view.title}</strong>
        </div>
      </div>
      {lan?.qr && (
        <div className="ob-phone">
          <img
            className="ob-qr"
            src={lan.qr}
            alt="QR Code para abrir o painel em outro dispositivo"
          />
          <div>
            <h3>Quer abrir o painel em outro dispositivo?</h3>
            <p>
              Escaneie o QR Code com a câmera do dispositivo. Ele abre o mesmo painel (dispositivo
              remoto e PC no mesmo Wi-Fi).
            </p>
            {lan.url && (
              <p className="ob-url">
                <span className="num">{lan.url}</span>{' '}
                <button
                  type="button"
                  className="cx-btn cx-btn-ghost cx-btn-sm"
                  onClick={async () => {
                    setCopied(await copyText(lan.url ?? ''));
                    setTimeout(() => setCopied(false), 1800);
                  }}
                >
                  {copied ? 'Copiado ✓' : 'Copiar'}
                </button>
              </p>
            )}
          </div>
        </div>
      )}
      <div className="cx-actions ob-actions">
        <button type="button" className="cx-btn cx-btn-lg" onClick={onNext}>
          Continuar
        </button>
      </div>
    </>
  );
}

function ReadyStep() {
  return (
    <>
      <Radar found />
      <h1>Tudo pronto!</h1>
      <p className="ob-lead">Agora é só pilotar. O painel ao vivo mostra tudo em tempo real.</p>
      <ul className="ob-tips">
        <li>
          <strong>Deslize</strong> para os lados para trocar de tela.
        </li>
        <li>
          <strong>Toque duas vezes</strong> para trocar a referência do delta.
        </li>
        <li>
          <strong>Segure</strong> a tela para escolher telas e ajustes.
        </li>
        <li>
          Depois da sessão, abra <strong>Início</strong> para ver suas pistas e onde ganhar tempo.
        </li>
      </ul>
      <div className="cx-actions ob-actions">
        <button type="button" className="cx-btn cx-btn-lg" onClick={() => finishOnboarding(true)}>
          Ir para o painel ao vivo
        </button>
      </div>
    </>
  );
}

export default function Onboarding() {
  const conn = useConsoleConnection();
  const linkState = conn?.state ?? null;
  const [step, setStep] = useState<OnboardingStep>('search');
  const [startedAt] = useState(() => Date.now());

  // Step 1 → 2 happens by itself the moment the console is found.
  useEffect(() => {
    setStep((cur) => nextStep(cur, linkState));
  }, [linkState]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finishOnboarding(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const idx = ONBOARDING_STEPS.indexOf(step);
  return (
    <div
      className="ob"
      data-no-gesture
      role="dialog"
      aria-modal="true"
      aria-label="Primeiros passos"
    >
      <div className="ob-top">
        <ol className="ob-steps" aria-label={`Passo ${idx + 1} de ${ONBOARDING_STEPS.length}`}>
          {ONBOARDING_STEPS.map((s, i) => (
            <li key={s} data-state={i < idx ? 'done' : i === idx ? 'current' : 'todo'} />
          ))}
        </ol>
        <button type="button" className="ob-skip" onClick={() => finishOnboarding(false)}>
          Pular
        </button>
      </div>
      <div className="ob-body">
        <div className="ob-card" key={step}>
          {step === 'search' && <SearchStep startedAt={startedAt} />}
          {step === 'found' && <FoundStep onNext={() => setStep('ready')} />}
          {step === 'ready' && <ReadyStep />}
        </div>
      </div>
    </div>
  );
}
