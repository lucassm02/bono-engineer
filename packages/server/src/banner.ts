/** Startup banner (pt-BR): local + LAN URLs, terminal QR, console and firewall status. */

import type { ConsoleIpSource, FirewallStatus, PacketFormat } from '@gt7/shared';
import { qrTerminal } from './lan.ts';

export interface BannerInput {
  version: string;
  localUrl: string;
  lanUrls: string[];
  preferredUrl: string | null;
  devUrl: string | null;
  consoleIp: string | null;
  consoleSource?: ConsoleIpSource | null;
  liveFormat: PacketFormat;
  /** The packet format is automatic (default) rather than pinned. */
  liveFormatAuto?: boolean;
  simulator: boolean;
  dataDir: string;
  /** Old data folder copied to `dataDir` on this run (null when nothing was migrated). */
  dataMigratedFrom?: string | null;
  /** Why the port is not the default one (null when it is). */
  portNote?: string | null;
  webBuilt: boolean;
  tokenRequired: boolean;
  host: string;
}

export async function renderBanner(b: BannerInput): Promise<string> {
  const lines: string[] = [];
  const title = `GT7 Race Engineer — servidor v${b.version}`;
  lines.push('', `  ${title}`, `  ${'─'.repeat(title.length)}`);
  lines.push(`  Neste PC:     ${b.localUrl}`);
  if (b.devUrl) lines.push(`  Vite (dev):   ${b.devUrl}`);
  if (b.lanUrls.length) {
    lines.push(`  No celular:   ${b.preferredUrl ?? b.lanUrls[0]}   (mesma rede Wi-Fi)`);
    for (const u of b.lanUrls.slice(1)) lines.push(`                ${u}`);
  } else if (b.host === '127.0.0.1' || b.host === 'localhost') {
    lines.push('  No celular:   indisponível (escutando só em 127.0.0.1; use --host 0.0.0.0)');
  } else {
    lines.push('  No celular:   nenhuma rede local encontrada');
  }
  if (b.portNote) lines.push(`  Porta:        ${b.portNote}`);
  if (b.tokenRequired)
    lines.push('  Acesso:       protegido por token (abra pelo endereço com ?token=)');
  if (!b.webBuilt) {
    lines.push(
      b.devUrl
        ? '  Painel:       servido pelo Vite (modo dev)'
        : '  Painel:       não foi possível montar — rode "npm install" e "npm run build" (a API já funciona)',
    );
  }
  const fmt = b.liveFormatAuto === false ? `formato '${b.liveFormat}' fixo` : 'formato automático';
  lines.push(
    b.simulator
      ? '  Console:      SIMULADOR (dados sintéticos de demonstração)'
      : b.consoleIp
        ? `  Console:      ${b.consoleIp} (${b.consoleSource === 'discovered' ? 'encontrado sozinho' : 'IP fixado'}, ${fmt})`
        : `  Console:      procurando o PlayStation na rede, automático (${fmt})`,
  );
  lines.push(`  Dados:        ${b.dataDir}`);
  if (b.dataMigratedFrom)
    lines.push(`                (copiados de ${b.dataMigratedFrom}; a pasta antiga foi mantida)`);
  const qrTarget = b.preferredUrl;
  if (qrTarget) {
    try {
      const qr = await qrTerminal(qrTarget);
      lines.push(
        '',
        '  Aponte a câmera do celular:',
        ...qr
          .trimEnd()
          .split('\n')
          .map((l) => `  ${l}`),
      );
    } catch {
      // QR is a nicety
    }
  }
  lines.push('', '  Ctrl+C para encerrar.', '');
  return lines.join('\n');
}

export function renderFirewall(fw: FirewallStatus): string | null {
  if (fw.state === 'ok') return '  Firewall:     regras de entrada OK';
  if (fw.state === 'unknown') {
    return fw.platform === 'win32'
      ? '  Firewall:     não foi possível verificar o Firewall do Windows'
      : null;
  }
  const missing = fw.rules.filter((r) => r.present === false).map((r) => `${r.protocol} ${r.port}`);
  return [
    `  Firewall:     faltam regras de entrada (${missing.join(', ')}) — o celular pode não conectar.`,
    '                Abra o PowerShell como Administrador e rode:',
    ...fw.powershellCommands.map((c) => `                  ${c}`),
    '                (A rede Wi-Fi precisa estar como "Privada". Se já liberou o Node.js, ignore.)',
    '',
  ].join('\n');
}
