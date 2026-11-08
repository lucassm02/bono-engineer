/**
 * Rule-based corner diagnoses (pt-BR) for the coach: compares a corner's metrics of the subject lap
 * with the reference lap, estimates the time cost of each finding from the distance delta of the
 * corner phases, and attaches ONE concrete action per finding.
 *
 * Cost model: each phase loss (braking zone, mid corner, exit, following straight) is split among
 * the findings that act on that phase, proportionally to their severity (magnitude / threshold,
 * capped at 4). Phases where time was gained contribute nothing.
 */

import type {
  Corner,
  CornerFinding,
  CornerMetrics,
  CornerPhaseLoss,
  FindingConfidence,
} from '@gt7/shared';
import { fmt } from './math.ts';

type Phase = keyof CornerPhaseLoss;

interface Candidate {
  finding: CornerFinding;
  severity: number;
  phases: Phase[];
  /** Precision depends on distances (replay smoothing shifts them a few meters). */
  distanceBased?: boolean;
  /** Depends on the pedal/steering shape (smoothed in replays). */
  inputShape?: boolean;
}

export interface DiagnoseOptions {
  /** Reference captured from a replay (smoothed inputs). */
  referenceIsReplay?: boolean;
  /** Thresholds (defaults in parentheses). */
  brakePointM?: number; // 5
  minSpeedKmh?: number; // 2
  throttleM?: number; // 8
  exitSpeedKmh?: number; // 3
  lineM?: number; // 1.2
}

const LEVELS: FindingConfidence[] = ['low', 'medium', 'high'];

function round5(x: number): number {
  return Math.max(5, Math.round(x / 5) * 5);
}

function ord(g: number): string {
  return `${g}ª`;
}

function label(c: Corner): string {
  return c.name ? `${c.id} (${c.name})` : c.id;
}

/** Diagnoses one corner; returns findings ranked by estimated cost (ms, desc). */
export function diagnoseCorner(
  corner: Corner,
  a: CornerMetrics,
  b: CornerMetrics,
  phaseLoss: CornerPhaseLoss,
  opts: DiagnoseOptions = {},
): CornerFinding[] {
  const T = label(corner);
  const out: Candidate[] = [];
  const thBrake = opts.brakePointM ?? 5;
  const thV = opts.minSpeedKmh ?? 2;
  const thThr = opts.throttleM ?? 8;
  const thExit = opts.exitSpeedKmh ?? 3;
  const thLine = opts.lineM ?? 1.2;
  const sev = (x: number) => Math.min(4, Math.max(0, x));
  const add = (
    f: Omit<CornerFinding, 'cornerId'>,
    severity: number,
    phases: Phase[],
    extra: Partial<Candidate> = {},
  ) =>
    out.push({ finding: { ...f, cornerId: corner.id }, severity: sev(severity), phases, ...extra });

  const dv = a.minSpeedKmh - b.minSpeedKmh;
  const dExit =
    a.exitSpeedKmh !== null && b.exitSpeedKmh !== null ? a.exitSpeedKmh - b.exitSpeedKmh : null;

  // ---- braking point ----
  if (a.brakePointM !== null && b.brakePointM !== null) {
    const early = b.brakePointM - a.brakePointM;
    const marker = round5(corner.entryM - b.brakePointM);
    if (early >= thBrake) {
      const vPart = dv <= -3 ? ` e sua V-mín é ${fmt(-dv)} km/h menor` : '';
      add(
        {
          kind: 'brakeEarlier',
          value: early,
          unit: 'm',
          subjectValue: a.brakePointM,
          referenceValue: b.brakePointM,
          message: `Você freia ${fmt(early)} m antes da referência na ${T}${vPart}`,
          action: `Freie mais tarde, perto do marco de ${marker} m antes da curva.`,
        },
        early / thBrake,
        ['brakingMs'],
        { distanceBased: true },
      );
    } else if (-early >= thBrake && dv <= -thV && phaseLoss.brakingMs + phaseLoss.midMs > 20) {
      add(
        {
          kind: 'brakeLater',
          value: -early,
          unit: 'm',
          subjectValue: a.brakePointM,
          referenceValue: b.brakePointM,
          message: `Você freia ${fmt(-early)} m depois da referência na ${T} e chega lento ao ápice (V-mín ${fmt(-dv)} km/h menor)`,
          action: `Freie perto do marco de ${marker} m e solte o freio progressivamente até o ápice.`,
        },
        -early / thBrake,
        ['brakingMs', 'midMs'],
        { distanceBased: true },
      );
    }
  }

  // ---- brake pressure ----
  if (a.peakBrake !== null && b.peakBrake !== null && b.peakBrake >= 0.5) {
    const d = b.peakBrake - a.peakBrake;
    const minD = opts.referenceIsReplay ? 0.2 : 0.12;
    if (d >= minD) {
      add(
        {
          kind: 'softBraking',
          value: d,
          unit: 'ratio',
          subjectValue: a.peakBrake,
          referenceValue: b.peakBrake,
          message: `Pico de freio de ${fmt(a.peakBrake * 100)}% na ${T}, contra ${fmt(b.peakBrake * 100)}% da referência`,
          action: 'Pise forte logo no início da frenagem e vá aliviando conforme a velocidade cai.',
        },
        d / 0.12,
        ['brakingMs'],
        { inputShape: true },
      );
    }
  }

  // ---- trail braking ----
  if (b.trailBrakingS !== null && b.trailBrakingS >= 0.25) {
    const at = a.trailBrakingS ?? 0;
    if (at < 0.4 * b.trailBrakingS) {
      add(
        {
          kind: 'noTrailBraking',
          value: b.trailBrakingS - at,
          unit: 's',
          subjectValue: at,
          referenceValue: b.trailBrakingS,
          message: `Solta o freio antes de virar na ${T} (freio + volante por ${fmt(at, 1)} s, referência ${fmt(b.trailBrakingS, 1)} s)`,
          action:
            'Leve um pouco de freio até perto do ápice (trail braking), aliviando conforme vira.',
        },
        (b.trailBrakingS - at) / 0.25,
        ['brakingMs', 'midMs'],
        { inputShape: true },
      );
    }
  }

  // ---- coasting ----
  if (a.coastingS >= 0.25 && a.coastingS - b.coastingS >= 0.15) {
    add(
      {
        kind: 'coasting',
        value: a.coastingS,
        unit: 's',
        subjectValue: a.coastingS,
        referenceValue: b.coastingS,
        message: `${fmt(a.coastingS, 1)} s em roda livre na ${T} (sem freio nem acelerador)`,
        action: 'Emende freio e acelerador: não fique sem pedal entre a frenagem e a retomada.',
      },
      (a.coastingS - b.coastingS) / 0.2,
      ['brakingMs', 'midMs'],
      { inputShape: true },
    );
  }

  // ---- minimum speed ----
  if (dv <= -thV) {
    add(
      {
        kind: 'lowerMinSpeed',
        value: -dv,
        unit: 'kmh',
        subjectValue: a.minSpeedKmh,
        referenceValue: b.minSpeedKmh,
        message: `V-mín ${fmt(-dv)} km/h menor que a referência na ${T} (${fmt(a.minSpeedKmh)} vs ${fmt(b.minSpeedKmh)} km/h)`,
        action:
          'Carregue mais velocidade até o ápice: alivie o freio mais cedo no fim da frenagem.',
      },
      -dv / thV,
      ['midMs'],
    );
  } else if (dv >= 3 && dExit !== null && dExit <= -thExit) {
    add(
      {
        kind: 'higherMinSpeed',
        value: dv,
        unit: 'kmh',
        subjectValue: a.minSpeedKmh,
        referenceValue: b.minSpeedKmh,
        message: `V-mín ${fmt(dv)} km/h maior na ${T}, mas a saída é ${fmt(-dExit)} km/h mais lenta`,
        action: 'Entre um pouco mais devagar para endireitar o carro e acelerar mais cedo.',
      },
      dv / 3,
      ['midMs', 'exitMs'],
    );
  }

  // ---- apex location (only short corners have a well-defined speed minimum) ----
  if (corner.exitM - corner.entryM <= 80) {
    const dA = a.apexM - b.apexM;
    if (Math.abs(dA) >= 15) {
      const early = dA < 0;
      add(
        {
          kind: early ? 'earlyApex' : 'lateApex',
          value: Math.abs(dA),
          unit: 'm',
          subjectValue: a.apexM,
          referenceValue: b.apexM,
          message: early
            ? `Seu ápice (V-mín) está ${fmt(-dA)} m antes do da referência na ${T}: tangenciando cedo`
            : `Seu ápice (V-mín) está ${fmt(dA)} m depois do da referência na ${T}`,
          action: early
            ? 'Vire um pouco mais tarde para mirar um ápice mais adiante e abrir a saída.'
            : 'Aponte para o ápice um pouco mais cedo para começar a acelerar antes.',
        },
        Math.abs(dA) / 25,
        ['midMs'],
        { distanceBased: true },
      );
    }
  }

  // ---- throttle ----
  if (a.throttlePickupM !== null && b.throttlePickupM !== null) {
    const late = a.throttlePickupM - b.throttlePickupM;
    if (late >= thThr) {
      add(
        {
          kind: 'lateThrottle',
          value: late,
          unit: 'm',
          subjectValue: a.throttlePickupM,
          referenceValue: b.throttlePickupM,
          message: `Acelera ${fmt(late)} m depois da referência na ${T}`,
          action: 'Volte ao acelerador logo após o ápice, de forma progressiva.',
        },
        late / thThr,
        ['midMs', 'exitMs'],
        { distanceBased: true },
      );
    }
  }

  // ---- line ----
  if (a.lateralOffsetM && b.lateralOffsetM) {
    const inside = corner.direction === 'left' ? 1 : -1; // + lateral = left
    const pts = (['entry', 'apex', 'exit'] as const).map((p) => ({
      p,
      inner: (a.lateralOffsetM![p] - b.lateralOffsetM![p]) * inside,
    }));
    const bad = pts
      .filter(
        (x) =>
          (x.p === 'entry' && x.inner >= thLine) ||
          (x.p === 'apex' && x.inner <= -thLine) ||
          (x.p === 'exit' && (x.inner >= thLine || x.inner <= -2.5)),
      )
      .sort((u, v) => Math.abs(v.inner) - Math.abs(u.inner))[0];
    if (bad) {
      const d = Math.abs(bad.inner);
      const text = {
        entry: {
          message: `Entrada ${fmt(d, 1)} m mais para dentro que a referência na ${T}`,
          action:
            'Abra mais na entrada: posicione o carro mais perto da borda externa antes de virar.',
          phases: ['brakingMs', 'midMs'] as Phase[],
        },
        apex: {
          message: `Ápice ${fmt(d, 1)} m mais por fora que a referência na ${T}`,
          action: 'Feche mais no ápice: passe rente à zebra interna.',
          phases: ['midMs'] as Phase[],
        },
        exit:
          bad.inner > 0
            ? {
                message: `Saída ${fmt(d, 1)} m mais para dentro que a referência na ${T}`,
                action:
                  'Use toda a pista na saída: deixe o carro abrir até a borda externa acelerando.',
                phases: ['exitMs'] as Phase[],
              }
            : {
                message: `Saída ${fmt(d, 1)} m mais aberta que a referência na ${T}`,
                action: 'Dose o acelerador na saída para não abrir além da pista.',
                phases: ['exitMs'] as Phase[],
              },
      }[bad.p];
      add(
        {
          kind: 'lineOffset',
          value: d,
          unit: 'm',
          subjectValue: a.lateralOffsetM[bad.p],
          referenceValue: b.lateralOffsetM[bad.p],
          message: text.message,
          action: text.action,
        },
        d / thLine,
        text.phases,
      );
    }
  }

  // ---- traction ----
  const dTcs = a.tcsActiveS - b.tcsActiveS;
  const dSlip =
    a.rearSlipPeak !== null && b.rearSlipPeak !== null ? a.rearSlipPeak - b.rearSlipPeak : 0;
  if (dTcs >= 0.15 || (dSlip >= 0.05 && (a.rearSlipPeak ?? 0) >= 0.1)) {
    const tcsTxt = a.tcsActiveS > 0 ? `TCS atuando ${fmt(a.tcsActiveS, 1)} s` : '';
    const slipTxt = a.rearSlipPeak !== null ? `patinagem ${fmt(a.rearSlipPeak * 100)}%` : '';
    add(
      {
        kind: 'exitSlip',
        value: dTcs >= 0.15 ? a.tcsActiveS : dSlip,
        unit: dTcs >= 0.15 ? 's' : 'ratio',
        subjectValue: dTcs >= 0.15 ? a.tcsActiveS : a.rearSlipPeak,
        referenceValue: dTcs >= 0.15 ? b.tcsActiveS : b.rearSlipPeak,
        message: `Rodas traseiras patinando na saída da ${T} (${[tcsTxt, slipTxt].filter(Boolean).join(', ')})`,
        action: 'Dose o acelerador na saída: abra progressivamente até o volante estar quase reto.',
      },
      Math.max(dTcs / 0.15, dSlip / 0.05),
      ['exitMs'],
      { inputShape: true },
    );
  }
  if (a.frontLockS >= 0.08 && a.frontLockS - b.frontLockS >= 0.05) {
    add(
      {
        kind: 'frontLock',
        value: a.frontLockS,
        unit: 's',
        subjectValue: a.frontLockS,
        referenceValue: b.frontLockS,
        message: `Travando a dianteira na frenagem da ${T} (${fmt(a.frontLockS, 1)} s)`,
        action: 'Alivie um pouco o pico de freio: module a pressão quando sentir a roda travar.',
      },
      a.frontLockS / 0.1,
      ['brakingMs'],
      { inputShape: true },
    );
  }

  // ---- steering ----
  if (a.steeringCorrections !== null) {
    const bs = b.steeringCorrections ?? 0;
    if (a.steeringCorrections >= 4 && a.steeringCorrections - bs >= 3) {
      add(
        {
          kind: 'steeringCorrections',
          value: a.steeringCorrections,
          unit: 'count',
          subjectValue: a.steeringCorrections,
          referenceValue: b.steeringCorrections,
          message: `Muitas correções de volante na ${T} (${a.steeringCorrections} contra ${bs} da referência)`,
          action:
            'Suavize o volante: uma entrada só e constante; se a traseira escapa, entre mais devagar.',
        },
        (a.steeringCorrections - bs) / 3,
        ['midMs'],
        { inputShape: true },
      );
    }
  }

  // ---- gear ----
  if (a.gearAtApex > 0 && b.gearAtApex > 0 && a.gearAtApex !== b.gearAtApex) {
    add(
      {
        kind: 'gearChoice',
        value: a.gearAtApex - b.gearAtApex,
        unit: 'gear',
        subjectValue: a.gearAtApex,
        referenceValue: b.gearAtApex,
        message: `A referência faz a ${T} em ${ord(b.gearAtApex)}, você em ${ord(a.gearAtApex)}`,
        action: `Experimente a ${ord(b.gearAtApex)} marcha no ápice da ${corner.id}.`,
      },
      0.8,
      ['midMs', 'exitMs'],
    );
  }

  // ---- exit speed ----
  if (dExit !== null && dExit <= -thExit) {
    add(
      {
        kind: 'slowerExit',
        value: -dExit,
        unit: 'kmh',
        subjectValue: a.exitSpeedKmh,
        referenceValue: b.exitSpeedKmh,
        message: `Saída ${fmt(-dExit)} km/h mais lenta na ${T}: custa tempo em toda a reta seguinte`,
        action: 'Priorize a saída: ápice um pouco mais tarde e acelerador mais cedo.',
      },
      -dExit / thExit,
      ['exitMs', 'followingStraightMs'],
    );
  }

  // ---- cost allocation ----
  const phases: Phase[] = ['brakingMs', 'midMs', 'exitMs', 'followingStraightMs'];
  for (const c of out) c.finding.costMs = 0;
  for (const p of phases) {
    const loss = phaseLoss[p];
    if (!(loss > 0)) continue;
    const members = out.filter((c) => c.phases.includes(p));
    const total = members.reduce((acc, c) => acc + c.severity, 0);
    if (total <= 0) continue;
    for (const c of members)
      c.finding.costMs = (c.finding.costMs ?? 0) + (loss * c.severity) / total;
  }

  // ---- confidence ----
  for (const c of out) {
    let lvl = c.severity >= 2 ? 2 : c.severity >= 1.4 ? 1 : 0;
    if (opts.referenceIsReplay) {
      if (c.inputShape) lvl--;
      if (c.distanceBased && c.finding.value < 10) lvl--;
    }
    if ((c.finding.costMs ?? 0) < 15) lvl = Math.min(lvl, 1);
    c.finding.confidence = LEVELS[Math.max(0, Math.min(2, lvl))]!;
    c.finding.costMs = Math.round(c.finding.costMs ?? 0);
  }

  return out
    .sort((u, v) => (v.finding.costMs ?? 0) - (u.finding.costMs ?? 0) || v.severity - u.severity)
    .map((c) => c.finding);
}

/** "Diagnosis: action" sentence of a finding (pt-BR). */
export function findingText(f: CornerFinding): string {
  if (!f.message) return f.kind;
  if (!f.action) return `${f.message}.`;
  const action = f.action.charAt(0).toLowerCase() + f.action.slice(1);
  return `${f.message}: ${action}`;
}
