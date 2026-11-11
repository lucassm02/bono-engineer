import type { ConsoleConnection } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import {
  buildHealth,
  CONFIG_ENTRIES,
  CONFIG_GROUP_IDS,
  type HealthInput,
  healthHeadline,
  matchScreenPreset,
  pendingSetupSteps,
  resolveConfigTarget,
  SCREEN_PRESETS,
  searchConfig,
  shouldShowSearch,
} from './configNav.ts';

function link(state: ConsoleConnection['state'], consoleIp: string | null = null) {
  return {
    state,
    consoleIp,
    source: consoleIp ? 'discovered' : null,
    subnets: [],
    hostsProbed: 0,
    lastPacketAt: null,
    lastScanAt: null,
    hint: null,
  } as unknown as ConsoleConnection;
}

const base: HealthInput = {
  link: link('receiving', '192.168.0.20'),
  engineer: { enabled: true, muted: false, voiceName: 'Alex', audio: 'here' },
  recording: { autoCapture: true, raw: false },
  discord: null,
  devicesOnline: 0,
  firewall: 'ok',
};

const byId = (items: ReturnType<typeof buildHealth>, id: string) => items.find((x) => x.id === id)!;

describe('resolveConfigTarget (âncoras antigas → grupo novo)', () => {
  it('mapeia cada âncora antiga para o grupo certo', () => {
    const cases: Record<string, [string, string | undefined]> = {
      idioma: ['contas', 'idioma'],
      conexao: ['console', 'conexao'],
      captura: ['console', 'captura'],
      'acesso-remoto': ['painel', 'acesso-remoto'],
      lan: ['painel', 'acesso-remoto'],
      celular: ['painel', 'acesso-remoto'],
      dispositivos: ['painel', 'dispositivos'],
      aparelhos: ['painel', 'dispositivos'],
      discord: ['contas', 'discord'],
      coach: ['contas', 'coach'],
      dados: ['contas', 'dados'],
      mcp: ['contas', 'mcp'],
      ia: ['contas', 'mcp'],
      sobre: ['sobre', undefined],
      console: ['console', undefined],
    };
    for (const [old, [group, anchor]] of Object.entries(cases)) {
      const t = resolveConfigTarget(old);
      expect(t.group, old).toBe(group);
      expect(t.anchor, old).toBe(anchor);
    }
  });

  it('aceita os ids dos grupos novos e cai no Início quando não conhece', () => {
    for (const id of CONFIG_GROUP_IDS) expect(resolveConfigTarget(id)).toEqual({ group: id });
    expect(resolveConfigTarget(undefined).group).toBe('inicio');
    expect(resolveConfigTarget('').group).toBe('inicio');
    expect(resolveConfigTarget('nao-existe').group).toBe('inicio');
    expect(resolveConfigTarget(' MCP ').group).toBe('contas');
  });
});

describe('busca', () => {
  it('só aparece com mais de 12 linhas', () => {
    expect(shouldShowSearch(12)).toBe(false);
    expect(shouldShowSearch(13)).toBe(true);
    expect(shouldShowSearch(CONFIG_ENTRIES.length)).toBe(true);
  });

  it('“delta” encontra uma única linha (referência do delta em um só lugar)', () => {
    const hits = searchConfig('delta', CONFIG_ENTRIES, { desktop: true });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.group).toBe('engenheiro');
  });

  it('ignora acentos e exige todas as palavras', () => {
    expect(searchConfig('gravar sessoes')[0]?.id).toBe('auto-record');
    expect(searchConfig('voz testar').map((e) => e.id)).toEqual(['voice']);
    expect(searchConfig('')).toEqual([]);
  });

  it('esconde o Discord fora do app de desktop', () => {
    expect(searchConfig('discord').some((e) => e.id === 'discord')).toBe(false);
    expect(
      searchConfig('discord', CONFIG_ENTRIES, { desktop: true }).some((e) => e.id === 'discord'),
    ).toBe(true);
  });

  it('não usa termos proibidos pelo glossário nos títulos', () => {
    for (const e of CONFIG_ENTRIES) {
      expect(e.title.toLowerCase(), e.id).not.toMatch(/dispositivo remoto|dashboard|top capturado/);
    }
  });
});

describe('passos pendentes do assistente (gt7.setup.v2)', () => {
  it('sem estado (ou ilegível) não há cartão', () => {
    expect(pendingSetupSteps(null)).toBeNull();
    expect(pendingSetupSteps('')).toBeNull();
    expect(pendingSetupSteps('{quebrado')).toBeNull();
    expect(pendingSetupSteps('42')).toBeNull();
  });

  it('lista os passos ainda não feitos, na ordem do assistente', () => {
    const raw = JSON.stringify({
      version: 2,
      steps: { welcome: true, console: 'done', engineer: false },
      done: false,
    });
    expect(pendingSetupSteps(raw)?.map((s) => s.id)).toEqual(['mode', 'engineer', 'panel']);
  });

  it('assistente encerrado = nada pendente', () => {
    expect(pendingSetupSteps(JSON.stringify({ version: 2, steps: {}, done: true }))).toEqual([]);
  });
});

describe('HealthSummary por estado', () => {
  it('tudo certo: PS5 e engenheiro ok, sem ação no PS5', () => {
    const items = buildHealth(base);
    expect(items.map((i) => i.id)).toEqual(['console', 'engineer', 'recording', 'devices']);
    expect(byId(items, 'console')).toMatchObject({ tone: 'ok', action: null });
    expect(byId(items, 'console').detail).toContain('192.168.0.20');
    expect(byId(items, 'engineer')).toMatchObject({
      tone: 'ok',
      action: { kind: 'toggleEngineer', label: 'Desligar' },
    });
    expect(byId(items, 'recording')).toMatchObject({ tone: 'ok' });
    expect(healthHeadline(items.filter((i) => i.id !== 'devices')).tone).toBe('ok');
  });

  it('PS5 procurando / perdido / parado oferecem “Procurar de novo”', () => {
    for (const [state, tone] of [
      ['searching', 'busy'],
      ['lost', 'warn'],
      ['idle', 'bad'],
    ] as const) {
      const item = byId(buildHealth({ ...base, link: link(state) }), 'console');
      expect(item.tone, state).toBe(tone);
      expect(item.action).toMatchObject({ kind: 'rescan', label: 'Procurar de novo' });
    }
    expect(byId(buildHealth({ ...base, link: null }), 'console').tone).toBe('warn');
  });

  it('engenheiro desligado e sem som', () => {
    const off = byId(
      buildHealth({ ...base, engineer: { ...base.engineer, enabled: false } }),
      'engineer',
    );
    expect(off).toMatchObject({ tone: 'off', action: { label: 'Ligar' } });
    const muted = byId(
      buildHealth({ ...base, engineer: { ...base.engineer, muted: true } }),
      'engineer',
    );
    expect(muted.tone).toBe('warn');
  });

  it('gravação desligada pede atenção e oferece ligar; sem dados ainda, o item some', () => {
    const items = buildHealth({ ...base, recording: { autoCapture: false, raw: false } });
    expect(byId(items, 'recording')).toMatchObject({ tone: 'warn', action: { label: 'Ligar' } });
    expect(buildHealth({ ...base, recording: null }).some((i) => i.id === 'recording')).toBe(false);
  });

  it('Discord só entra no desktop e cobre os três estados', () => {
    expect(buildHealth(base).some((i) => i.id === 'discord')).toBe(false);
    const d = (x: NonNullable<HealthInput['discord']>) =>
      byId(buildHealth({ ...base, discord: x }), 'discord');
    expect(d({ configured: false, enabled: false, error: false })).toMatchObject({
      tone: 'off',
      action: { kind: 'goto', target: { group: 'contas', anchor: 'discord' } },
    });
    expect(d({ configured: true, enabled: true, error: false }).tone).toBe('ok');
    expect(d({ configured: true, enabled: false, error: false }).tone).toBe('off');
    expect(
      d({ configured: true, enabled: true, error: true, message: 'Sem permissão' }),
    ).toMatchObject({
      tone: 'bad',
      detail: 'Sem permissão',
    });
  });

  it('aparelhos: online, nenhum e firewall bloqueando', () => {
    expect(byId(buildHealth({ ...base, devicesOnline: 1 }), 'devices')).toMatchObject({
      tone: 'ok',
      title: '1 aparelho online',
    });
    expect(byId(buildHealth({ ...base, devicesOnline: 3 }), 'devices').title).toBe(
      '3 aparelhos online',
    );
    expect(byId(buildHealth(base), 'devices')).toMatchObject({
      tone: 'off',
      action: { target: { group: 'painel', anchor: 'acesso-remoto' } },
    });
    expect(byId(buildHealth({ ...base, firewall: 'missing' }), 'devices')).toMatchObject({
      tone: 'warn',
      action: { label: 'Corrigir', target: { group: 'painel', anchor: 'firewall' } },
    });
    // com aparelho online o firewall não importa
    expect(
      byId(buildHealth({ ...base, firewall: 'missing', devicesOnline: 2 }), 'devices').tone,
    ).toBe('ok');
  });

  it('manchete: problema > atenção > tudo certo', () => {
    expect(healthHeadline(buildHealth({ ...base, link: link('idle') })).tone).toBe('bad');
    expect(
      healthHeadline(buildHealth({ ...base, recording: { autoCapture: false, raw: false } })).tone,
    ).toBe('warn');
  });
});

describe('presets de telas', () => {
  it('cada preset é reconhecido pela própria lista de telas', () => {
    for (const p of SCREEN_PRESETS) expect(matchScreenPreset(p.views)).toBe(p.id);
    expect(matchScreenPreset(['mapa'])).toBeNull();
  });

  it('a ordem importa e todos começam por Corrida', () => {
    expect(matchScreenPreset(['deltaGrande', 'corrida'])).toBeNull();
    for (const p of SCREEN_PRESETS) expect(p.views[0]).toBe('corrida');
  });
});
