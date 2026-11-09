/**
 * Windows Firewall helper: checks whether our inbound rules exist (via `netsh`, read-only) and
 * produces the exact elevated commands for the user to create them. Never changes the firewall.
 */

import { execFile } from 'node:child_process';
import { type FirewallRuleStatus, type FirewallStatus, GT7_CLIENT_PORT } from '@gt7/shared';

export const RULE_PREFIX = 'GT7 Race Engineer';

export interface FirewallRuleSpec {
  name: string;
  protocol: 'TCP' | 'UDP';
  port: number;
}

export function firewallRules(httpPort: number, udpPort = GT7_CLIENT_PORT): FirewallRuleSpec[] {
  return [
    { name: `${RULE_PREFIX} (TCP ${httpPort})`, protocol: 'TCP', port: httpPort },
    { name: `${RULE_PREFIX} (UDP ${udpPort})`, protocol: 'UDP', port: udpPort },
  ];
}

export function powershellCommand(r: FirewallRuleSpec): string {
  return `New-NetFirewallRule -DisplayName "${r.name}" -Direction Inbound -Protocol ${r.protocol} -LocalPort ${r.port} -Action Allow -Profile Private`;
}

export function netshCommand(r: FirewallRuleSpec): string {
  return `netsh advfirewall firewall add rule name="${r.name}" dir=in action=allow protocol=${r.protocol} localport=${r.port} profile=private`;
}

/** Runs a command and resolves with its exit code (null on spawn failure/timeout). */
export type ExecFn = (file: string, args: string[]) => Promise<{ code: number | null }>;

const defaultExec: ExecFn = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 5000, windowsHide: true }, (err) => {
      if (!err) return resolve({ code: 0 });
      const code = (err as NodeJS.ErrnoException & { code?: unknown }).code;
      resolve({ code: typeof code === 'number' ? code : null });
    });
  });

export interface FirewallCheckerOptions {
  httpPort: number;
  udpPort?: number;
  platform?: NodeJS.Platform;
  exec?: ExecFn;
}

export class FirewallChecker {
  readonly rules: FirewallRuleSpec[];
  readonly platform: NodeJS.Platform;
  readonly #exec: ExecFn;
  #status: FirewallStatus;
  #checking: Promise<FirewallStatus> | null = null;

  constructor(opts: FirewallCheckerOptions) {
    this.rules = firewallRules(opts.httpPort, opts.udpPort);
    this.platform = opts.platform ?? process.platform;
    this.#exec = opts.exec ?? defaultExec;
    this.#status = this.#build(
      this.rules.map(() => null),
      null,
    );
  }

  get status(): FirewallStatus {
    return this.#status;
  }

  /** Checks the rules with `netsh advfirewall firewall show rule name=...` (read-only). */
  check(): Promise<FirewallStatus> {
    if (this.#checking) return this.#checking;
    this.#checking = (async () => {
      if (this.platform !== 'win32') {
        this.#status = this.#build(
          this.rules.map(() => null),
          Date.now(),
        );
        return this.#status;
      }
      const present = await Promise.all(
        this.rules.map(async (r) => {
          const { code } = await this.#exec('netsh', [
            'advfirewall',
            'firewall',
            'show',
            'rule',
            `name=${r.name}`,
          ]);
          // netsh exits 0 when the rule exists, 1 when "No rules match the specified criteria".
          return code === 0 ? true : code === 1 ? false : null;
        }),
      );
      this.#status = this.#build(present, Date.now());
      return this.#status;
    })().finally(() => {
      this.#checking = null;
    });
    return this.#checking;
  }

  #build(present: (boolean | null)[], checkedAt: number | null): FirewallStatus {
    const rules: FirewallRuleStatus[] = this.rules.map((r, i) => ({
      name: r.name,
      protocol: r.protocol,
      port: r.port,
      present: present[i] ?? null,
    }));
    const missing = this.rules.filter((_, i) => present[i] === false);
    let state: FirewallStatus['state'];
    let message: string;
    if (this.platform !== 'win32') {
      state = 'unknown';
      message = 'Verificação de firewall disponível só no Windows.';
    } else if (present.some((p) => p === null)) {
      state = 'unknown';
      message =
        checkedAt === null
          ? 'Verificando o Firewall do Windows…'
          : 'Não foi possível verificar o Firewall do Windows.';
    } else if (missing.length === 0) {
      state = 'ok';
      message = 'Regras de entrada do Firewall do Windows encontradas.';
    } else {
      state = 'missing';
      message =
        'Para abrir o painel em outro dispositivo, crie as regras de entrada no Firewall do ' +
        'Windows: abra o PowerShell como Administrador e rode os comandos abaixo. A rede Wi-Fi ' +
        'precisa estar como "Privada". (Se você já liberou o Node.js no firewall, pode ignorar.)';
    }
    const toCreate =
      this.platform !== 'win32'
        ? []
        : state === 'missing'
          ? missing
          : state === 'unknown'
            ? this.rules
            : [];
    return {
      state,
      platform: this.platform,
      rules,
      powershellCommands: toCreate.map(powershellCommand),
      netshCommands: toCreate.map(netshCommand),
      message,
      checkedAt,
    };
  }
}
