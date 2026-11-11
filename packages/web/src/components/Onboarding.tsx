/**
 * First-run assistant (3 short steps, nothing technical):
 *  1. open Gran Turismo 7 on a track while the app looks for the PS5 (live status),
 *  2. "PS5 encontrado ✓" + the QR code to race from the phone,
 *  3. all set → live dashboard.
 * Can be skipped at any time. After ~40 s without finding the console it offers a help checklist.
 * Runs inside the shared Modal (focus, Esc, backdrop); the footer carries Pular / Voltar / Próximo.
 */

import type { ApiStatus } from '@gt7/shared';
import { useEffect, useState } from 'react';
import { api } from '../analysis/api.ts';
import { copyText } from '../analysis/components/ui.tsx';
import { agoText, describeLink, hostsProbedText, ipSourceLabel } from '../lib/consoleLink.ts';
import { t as uiText } from '../lib/i18n.ts';
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
import { Icon } from './ui/Icon.tsx';
import { Modal } from './ui/Modal.tsx';

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
      <div className="ob-radar-core">
        <Icon name={found ? 'check' : 'remote'} size={34} className={found ? 'ob-check' : ''} />
      </div>
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
    <section
      className="ui-card ob-help"
      data-tone="warn"
      aria-label={uiText('Ajuda para achar o PS5')}
    >
      <h3 className="ui-card-title">{uiText('Ainda não achei o PS5. Vamos conferir:')}</h3>
      <ul>
        <li>
          <strong>{uiText('PS5 ligado e na mesma rede.')}</strong>
          {' ' +
            uiText(
              'Ele precisa estar no mesmo Wi-Fi (ou no mesmo roteador) que este PC. Evite a rede “convidado”.',
            )}
        </li>
        <li>
          <strong>{uiText('Gran Turismo 7 aberto numa pista.')}</strong>
          {' ' +
            uiText('No menu o PS5 não envia dados. Entre num Time Trial, treino livre ou replay.')}
        </li>
        <li>
          <strong>{uiText('Firewall do Windows.')}</strong>{' '}
          {!fw ? (
            uiText('Verificando…')
          ) : fw.state === 'ok' ? (
            uiText('Tudo liberado ✓')
          ) : (
            <>
              {fw.message}
              {fw.powershellCommands.length > 0 && (
                <>
                  <pre className="ob-code">{fw.powershellCommands.join('\n')}</pre>
                  <button
                    type="button"
                    className="ui-btn"
                    data-variant="secondary"
                    data-size="sm"
                    onClick={() => void copyText(fw.powershellCommands.join('\n'))}
                  >
                    <Icon name="copy" size={16} />
                    {uiText('Copiar comandos')}
                  </button>
                </>
              )}
            </>
          )}
        </li>
        <li>
          <strong>{uiText('Nenhum outro programa de telemetria aberto')}</strong>
          {` ${uiText('(SimHub, GT7 Dashboard…): só um deles pode falar com o PS5 por vez.')}`}
        </li>
      </ul>
      <div className="cx-actions">
        <button type="button" className="ui-btn" onClick={() => void rescanConsole()}>
          <Icon name="refresh" size={18} />
          {uiText('Procurar de novo')}
        </button>
        <button
          type="button"
          className="ui-btn"
          data-variant="secondary"
          aria-expanded={showIp}
          onClick={() => setShowIp((v) => !v)}
        >
          {uiText('Último recurso: informar o IP')}
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
    <div className="ob-step">
      <Radar found={false} />
      <p className="ob-lead">
        {`${uiText('No PS5,')} `}
        <strong>{uiText('abra o Gran Turismo 7 e entre em uma pista')}</strong>
        {` ${uiText('(ou num replay). O resto é comigo.')}`}
      </p>
      <div className="ui-card ob-live" data-tone={view.tone} role="status" aria-live="polite">
        <LinkDot tone={view.tone} busy={view.busy} />
        <div>
          <strong>{view.title}</strong>
          {conn && conn.state === 'searching' && (
            <span className="ob-live-sub">
              {conn.hostsProbed > 0 ? `${hostsProbedText(conn.hostsProbed)} · ` : ''}
              {agoText(conn.lastScanAt) === 'nunca'
                ? uiText('começando…')
                : uiText('varredura {0}', agoText(conn.lastScanAt))}
            </span>
          )}
        </div>
      </div>
      <div className="ob-progress" aria-hidden="true">
        <span />
      </div>
      {!help && (
        <p className="ui-help">
          {`${uiText('Pode levar alguns segundos. Se demorar mais de')} `}
          {Math.round(HELP_AFTER_MS / 1000)}
          {` ${uiText('s, eu mostro o que conferir.')}`}
        </p>
      )}
      {help && <HelpChecklist status={status} />}
    </div>
  );
}

function FoundStep() {
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
    <div className="ob-step">
      <Radar found />
      <p className="ob-lead">
        {conn?.consoleIp ? (
          <>
            {`${uiText('Console em')} `}
            <span className="num">{conn.consoleIp}</span> ({ipSourceLabel(conn.source)}).
          </>
        ) : (
          uiText('Console encontrado.')
        )}{' '}
        {conn?.state === 'receiving'
          ? uiText('Os dados já estão chegando.')
          : uiText('Assim que você entrar numa pista, os dados começam a chegar.')}
      </p>
      <div className="ui-card ob-live" data-tone={view.tone} role="status" aria-live="polite">
        <LinkDot tone={view.tone} busy={view.busy} />
        <div>
          <strong>{conn?.state === 'found' ? uiText('Aguardando o jogo') : view.title}</strong>
        </div>
      </div>
      {lan?.qr && (
        <div className="ui-card ob-phone">
          <img
            className="ob-qr"
            src={lan.qr}
            alt={uiText('QR Code para abrir o painel em outro dispositivo')}
          />
          <div>
            <h3 className="ui-card-title">{uiText('Quer abrir o painel em outro dispositivo?')}</h3>
            <p className="ui-help">
              {uiText(
                'Escaneie o QR Code com a câmera do dispositivo. Ele abre o mesmo painel (dispositivo remoto e PC no mesmo Wi-Fi).',
              )}
            </p>
            {lan.url && (
              <p className="ob-url">
                <span className="num">{lan.url}</span>{' '}
                <button
                  type="button"
                  className="ui-btn"
                  data-variant="secondary"
                  data-size="sm"
                  onClick={async () => {
                    setCopied(await copyText(lan.url ?? ''));
                    setTimeout(() => setCopied(false), 1800);
                  }}
                >
                  <Icon name={copied ? 'check' : 'copy'} size={16} />
                  {copied ? uiText('Copiado ✓') : uiText('Copiar')}
                </button>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReadyStep() {
  return (
    <div className="ob-step">
      <Radar found />
      <p className="ob-lead">
        {uiText('Agora é só pilotar. O painel ao vivo mostra tudo em tempo real.')}
      </p>
      <ul className="ob-tips">
        <li>
          <strong>{uiText('Deslize')}</strong>
          {` ${uiText('para os lados para trocar de tela.')}`}
        </li>
        <li>
          <strong>{uiText('Toque duas vezes')}</strong>
          {` ${uiText('para trocar a referência do delta.')}`}
        </li>
        <li>
          <strong>{uiText('Segure')}</strong>
          {` ${uiText('a tela para escolher telas e ajustes.')}`}
        </li>
        <li>
          {`${uiText('Depois da sessão, abra')} `}
          <strong>{uiText('Início')}</strong>
          {` ${uiText('para ver suas pistas e onde ganhar tempo.')}`}
        </li>
      </ul>
    </div>
  );
}

const TITLES: Record<OnboardingStep, string> = {
  get search() {
    return uiText('Conecte o {0}', GT7_INTEGRATION.name);
  },
  found: 'PS5 encontrado ✓',
  get ready() {
    return uiText('Tudo pronto!');
  },
};

export default function Onboarding() {
  const conn = useConsoleConnection();
  const linkState = conn?.state ?? null;
  const [step, setStep] = useState<OnboardingStep>('search');
  const [startedAt] = useState(() => Date.now());

  // Step 1 → 2 happens by itself the moment the console is found.
  useEffect(() => {
    setStep((cur) => nextStep(cur, linkState));
  }, [linkState]);

  const idx = ONBOARDING_STEPS.indexOf(step);
  return (
    <Modal
      open
      onClose={() => finishOnboarding(false)}
      className="bn-modal-text ob-modal"
      title={TITLES[step]}
      subtitle={uiText('Primeiros passos · {0} de {1}', idx + 1, ONBOARDING_STEPS.length)}
      hideClose
      dismissOnBackdrop={false}
      headerExtra={
        <ol
          className="ob-steps"
          aria-label={uiText('Passo {0} de {1}', idx + 1, ONBOARDING_STEPS.length)}
        >
          {ONBOARDING_STEPS.map((s, i) => (
            <li key={s} data-state={i < idx ? 'done' : i === idx ? 'current' : 'todo'} />
          ))}
        </ol>
      }
      footer={
        <>
          {step !== 'ready' && (
            <button
              type="button"
              className="ui-btn bn-foot-left"
              data-variant="ghost"
              onClick={() => finishOnboarding(false)}
            >
              {uiText('Pular')}
            </button>
          )}
          {step === 'ready' && (
            <button
              type="button"
              className="ui-btn bn-foot-left"
              data-variant="ghost"
              onClick={() => setStep('found')}
            >
              <Icon name="back" size={18} />
              {uiText('Voltar')}
            </button>
          )}
          {step === 'found' && (
            <button type="button" className="ui-btn" onClick={() => setStep('ready')}>
              {uiText('Continuar')}
              <Icon name="chevron-right" size={18} />
            </button>
          )}
          {step === 'ready' && (
            <button type="button" className="ui-btn" onClick={() => finishOnboarding(true)}>
              {uiText('Ir para o painel ao vivo')}
            </button>
          )}
        </>
      }
    >
      <div className="ob-card" key={step}>
        {step === 'search' && <SearchStep startedAt={startedAt} />}
        {step === 'found' && <FoundStep />}
        {step === 'ready' && <ReadyStep />}
      </div>
    </Modal>
  );
}
