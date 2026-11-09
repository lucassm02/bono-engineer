/** Actions of the console link: search again, pin an IP, go back to automatic. */

import { api } from '../analysis/api.ts';
import { isValidIpv4 } from '../lib/consoleLink.ts';
import { addNotice, useUi } from '../state/uiStore.ts';

function inDemo(): boolean {
  if (useUi.getState().source !== 'mock') return false;
  addNotice('info', 'Na demonstração não há console de verdade: nada foi enviado.');
  return true;
}

/** `POST /api/discovery/scan`: shows the new state right away (the next status confirms it). */
export async function rescanConsole(): Promise<boolean> {
  if (inDemo()) return false;
  try {
    const r = await api.discoveryScan();
    useUi.setState((s) =>
      s.serverStatus
        ? { serverStatus: { ...s.serverStatus, consoleConnection: r.consoleConnection } }
        : {},
    );
    addNotice(
      r.started ? 'info' : 'warn',
      r.started
        ? 'Procurando o PS5 de novo…'
        : 'A telemetria está parada, então não há o que procurar agora.',
    );
    return r.started;
  } catch (e) {
    addNotice('error', (e as Error).message, 7000);
    return false;
  }
}

/** Pins an IP typed by the user (validated). */
export async function pinConsoleIp(ip: string): Promise<boolean> {
  const value = ip.trim();
  if (!isValidIpv4(value)) {
    addNotice('warn', 'Esse endereço não parece um IP válido (exemplo: 192.168.0.20).', 5000);
    return false;
  }
  if (inDemo()) return false;
  try {
    await api.patchSettings({ consoleIp: value });
    addNotice('info', `IP do PS5 fixado em ${value}.`);
    return true;
  } catch (e) {
    addNotice('error', (e as Error).message, 7000);
    return false;
  }
}

/** Back to automatic discovery (`consoleIp: null`). */
export async function backToAutomatic(): Promise<boolean> {
  if (inDemo()) return false;
  try {
    await api.patchSettings({ consoleIp: null });
    addNotice('info', 'Voltou ao automático: o app procura o PS5 sozinho.');
    return true;
  } catch (e) {
    addNotice('error', (e as Error).message, 7000);
    return false;
  }
}
