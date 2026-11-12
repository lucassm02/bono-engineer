/**
 * Grupo "Ao vivo e aparelhos": a lista compacta de aparelhos (uma linha cada, com o preset de telas;
 * os detalhes só ao expandir), o acesso pelo celular (QR + endereços) e o acesso pela rede do
 * Windows em linguagem simples ("Liberado" / "Bloqueado — Corrigir").
 */

import {
  type ApiStatus,
  createDefaultDeviceProfile,
  type DeviceInfo,
  type DeviceProfile,
  VIEW_IDS,
  type ViewId,
} from '@gt7/shared';
import { useEffect, useState } from 'react';
import { Icon } from '../../../components/ui/Icon.tsx';
import { t as uiText } from '../../../lib/i18n.ts';
import { VIEW_LABELS } from '../../../lib/labels.ts';
import { send } from '../../../net/transport.ts';
import { dispatchProfile } from '../../../state/actions.ts';
import { addNotice, setProfile, useUi } from '../../../state/uiStore.ts';
import { api, request } from '../../api.ts';
import {
  matchScreenPreset,
  profileWithViews,
  SCREEN_PRESETS,
  type ScreenPresetId,
} from '../../lib/configNav.ts';
import { formatAgo } from '../../lib/labels.ts';
import { useFetch } from '../../useFetch.ts';
import { CodeBlock, CopyBtn } from '../CopyBlock.tsx';
import { Panel } from '../Panel.tsx';
import { ErrorBox, Loading } from '../ui.tsx';
import { CfgRow, CfgToggle, rowDomId, useSave } from './ConfigRow.tsx';

// ---------------------------------------------------------------------------------------------
// Aparelhos
// ---------------------------------------------------------------------------------------------

/** Grava o perfil de OUTRO aparelho no servidor (o aparelho recebe a mudança na hora). */
function saveRemoteProfile(profile: DeviceProfile): Promise<DeviceProfile> {
  return request<DeviceProfile>(
    'PUT',
    `/api/devices/${encodeURIComponent(profile.deviceId)}`,
    profile,
  );
}

function DeviceRow({
  device,
  mine,
  expanded,
  onToggle,
  onChanged,
}: {
  device: DeviceInfo;
  mine: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const myProfile = useUi((s) => s.profile);
  const { busy, run } = useSave();
  const [show, setShow] = useState<ViewId | null>(null);
  const profile: DeviceProfile =
    (mine ? myProfile : device.profile) ?? createDefaultDeviceProfile(device.deviceId, device.name);
  const presetId = matchScreenPreset(profile.views);
  const detailId = `cfg-dev-${device.deviceId}`;

  /** Aplica uma mudança de perfil: neste aparelho pela rota normal, nos outros pelo servidor. */
  async function apply(next: DeviceProfile, ok: string) {
    if (mine) {
      setProfile(next);
      send({ type: 'setDeviceProfile', profile: next });
      addNotice('info', ok);
      return;
    }
    if (await run(() => saveRemoteProfile(next), ok)) onChanged();
  }

  const pickPreset = (id: ScreenPresetId) => {
    const preset = SCREEN_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    void apply(
      profileWithViews(profile, preset.views, Date.now()),
      uiText('{0}: telas {1}.', device.name, preset.label),
    );
  };

  const flag = (change: Partial<Pick<DeviceProfile, 'popupsEnabled' | 'locked'>>, ok: string) =>
    apply({ ...profile, ...change, updatedAt: Date.now() }, ok);

  const enabled = profile.views.length ? profile.views : VIEW_IDS;
  const sel =
    show ??
    (device.currentView && enabled.includes(device.currentView)
      ? device.currentView
      : enabled[0]) ??
    'corrida';

  return (
    <li className="cfg-dev" data-online={device.online ? '1' : '0'}>
      <div className="cfg-dev-line">
        <span
          className="ui-dot"
          data-tone={device.online ? 'gain' : undefined}
          aria-hidden="true"
        />
        <div className="cfg-dev-name">
          <strong>{device.name}</strong>
          <span className="cfg-muted">
            {device.online
              ? [
                  uiText('online'),
                  device.connections > 1 ? uiText('{0} abas', device.connections) : null,
                  device.currentView ? VIEW_LABELS[device.currentView] : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : uiText('offline · {0}', formatAgo(device.lastSeenAt))}
          </span>
        </div>
        {mine && (
          <span className="ui-badge" data-tone="accent">
            {uiText('este')}
          </span>
        )}
        <select
          className="ui-select cfg-dev-preset"
          aria-label={uiText('Telas de {0}', device.name)}
          value={presetId ?? 'custom'}
          disabled={busy}
          onChange={(e) => pickPreset(e.currentTarget.value as ScreenPresetId)}
        >
          {SCREEN_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {!presetId && (
            <option value="custom" disabled>
              {uiText('Personalizado · {0} telas', profile.views.length)}
            </option>
          )}
        </select>
        <button
          type="button"
          className="ui-icon-btn"
          aria-expanded={expanded}
          aria-controls={detailId}
          aria-label={uiText('Detalhes de {0}', device.name)}
          onClick={onToggle}
        >
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
        </button>
      </div>

      {expanded && (
        <div className="cfg-dev-detail" id={detailId}>
          <div className="cfg-list">
            <CfgRow
              id={mine ? 'screens' : undefined}
              title={uiText('Telas ligadas')}
              description={profile.views.map((v) => VIEW_LABELS[v]).join(' · ')}
            >
              <span className="cfg-muted">
                {presetId
                  ? SCREEN_PRESETS.find((p) => p.id === presetId)?.description
                  : uiText('Montagem própria')}
              </span>
            </CfgRow>
            <CfgToggle
              id={mine ? 'lap-popup' : undefined}
              title={uiText('Cartão ao fechar a volta')}
              description={uiText('Mostra o tempo e os setores quando você completa uma volta.')}
              checked={profile.popupsEnabled}
              disabled={busy}
              onChange={() =>
                flag(
                  { popupsEnabled: !profile.popupsEnabled },
                  profile.popupsEnabled
                    ? uiText('Cartão ao fechar a volta desligado.')
                    : uiText('Cartão ao fechar a volta ligado.'),
                )
              }
            />
            <CfgToggle
              id={mine ? 'lock' : undefined}
              title={uiText('Travar gestos')}
              description={uiText(
                'Evita trocar de tela sem querer. Segure o cadeado para destravar.',
              )}
              checked={profile.locked}
              disabled={busy}
              onChange={() =>
                mine
                  ? dispatchProfile({ type: 'setLocked', locked: !profile.locked })
                  : void flag(
                      { locked: !profile.locked },
                      profile.locked ? uiText('Gestos destravados.') : uiText('Gestos travados.'),
                    )
              }
            />
            {device.online && (
              <CfgRow
                title={uiText('Mostrar uma tela agora')}
                description={uiText('Troca a tela que o aparelho está mostrando.')}
                wide
              >
                <div className="cfg-device-actions">
                  <select
                    className="ui-select"
                    value={sel}
                    aria-label={uiText('Tela para {0}', device.name)}
                    onChange={(e) => setShow(e.currentTarget.value as ViewId)}
                  >
                    {VIEW_IDS.map((v) => (
                      <option key={v} value={v} disabled={!enabled.includes(v)}>
                        {VIEW_LABELS[v]}
                        {enabled.includes(v) ? '' : uiText(' (desligada)')}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="ui-btn"
                    data-size="sm"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await run(
                          () => api.showView(device.deviceId, sel, myProfile.deviceId),
                          `${device.name}: ${VIEW_LABELS[sel]}.`,
                        )
                      ) {
                        setTimeout(onChanged, 600);
                      }
                    }}
                  >
                    {uiText('Mostrar tela')}
                  </button>
                </div>
              </CfgRow>
            )}
          </div>
          {mine && (
            <p className="cfg-hint">
              {uiText(
                'Para mudar a ordem das telas ou montar a Personalizada, segure a tela no ao vivo.',
              )}
            </p>
          )}
          <p className="cfg-hint cfg-id">
            {uiText('Identificador')}: {device.deviceId}
          </p>
        </div>
      )}
    </li>
  );
}

export function DevicesSection({ expandMine }: { expandMine?: boolean }) {
  const devices = useFetch('devices', () => api.devices(), 5000);
  const myProfile = useUi((s) => s.profile);
  const ws = useUi((s) => s.wsStatus);
  const myId = myProfile.deviceId;
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (expandMine) setOpen(myId);
  }, [expandMine, myId]);

  const known = devices.data ?? [];
  // Este aparelho sempre aparece, mesmo que o servidor ainda não o tenha listado.
  const list: DeviceInfo[] = known.some((d) => d.deviceId === myId)
    ? known
    : [
        {
          deviceId: myId,
          name: myProfile.name,
          online: ws === 'open',
          connections: ws === 'open' ? 1 : 0,
          currentView: null,
          lastSeenAt: null,
          profile: myProfile,
        },
        ...known,
      ];
  const sorted = list
    .slice()
    .sort(
      (a, b) =>
        Number(b.deviceId === myId) - Number(a.deviceId === myId) ||
        Number(b.online) - Number(a.online),
    );

  return (
    <Panel
      id="dispositivos"
      title={uiText('Aparelhos')}
      description={uiText('Escolha as telas de cada aparelho. Abra a linha para ver os detalhes.')}
    >
      <span id="telas" className="cfg-anchor" />
      {devices.error && !devices.data ? (
        <ErrorBox error={devices.error} compact onRetry={devices.reload} />
      ) : !devices.data && ws !== 'open' ? (
        <Loading />
      ) : (
        <ul className="cfg-devs" id={rowDomId('devices')}>
          {sorted.map((d) => (
            <DeviceRow
              key={d.deviceId}
              device={d}
              mine={d.deviceId === myId}
              expanded={open === d.deviceId}
              onToggle={() => setOpen(open === d.deviceId ? null : d.deviceId)}
              onChanged={devices.reload}
            />
          ))}
          {sorted.length === 1 && (
            <li className="cfg-hint cfg-dev-empty">
              {uiText(
                'Só este aparelho por enquanto. Abra o ao vivo no celular ou no tablet pelo QR Code abaixo.',
              )}
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// Abrir no celular + Windows
// ---------------------------------------------------------------------------------------------

function FirewallBlock({ status, onChange }: { status: ApiStatus; onChange: () => void }) {
  const fw = status.firewall;
  const { busy, run } = useSave();
  const [fixing, setFixing] = useState(false);
  const blocked = fw.state === 'missing';
  const ok = fw.state === 'ok';
  return (
    <div className="cfg-sub" id="firewall" data-state={fw.state}>
      <div className="cfg-sub-head" id={rowDomId('firewall')}>
        <div className="ui-toggle-text">
          <span className="ui-toggle-title">
            {uiText('Acesso pela rede (Windows)')}{' '}
            <span className="ui-badge" data-tone={ok ? 'gain' : blocked ? 'loss' : 'accent'}>
              {ok
                ? uiText('Liberado ✓')
                : blocked
                  ? uiText('Bloqueado — Corrigir')
                  : uiText('Não verificado')}
            </span>
          </span>
          <span className="ui-toggle-desc">
            {ok
              ? uiText('O Windows deixa celular e tablet abrirem o ao vivo.')
              : blocked
                ? uiText('O Windows está barrando celular e tablet. Libere em um minuto.')
                : fw.message}
          </span>
        </div>
        <div className="cfg-actions">
          {blocked && (
            <button
              type="button"
              className="ui-btn"
              data-size="sm"
              aria-expanded={fixing}
              onClick={() => setFixing((v) => !v)}
            >
              {uiText('Corrigir')}
            </button>
          )}
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            data-size="sm"
            disabled={busy}
            onClick={async () => {
              if (await run(() => api.firewallCheck(), uiText('Acesso verificado.'))) onChange();
            }}
          >
            <Icon name="refresh" size={14} />
            {uiText('Verificar de novo')}
          </button>
        </div>
      </div>
      {blocked && fixing && (
        <div className="cfg-fix">
          <p className="cfg-lead">
            {uiText(
              'Abra o PowerShell como administrador (botão direito no menu Iniciar), cole os comandos abaixo e volte aqui para verificar de novo.',
            )}
          </p>
          {fw.rules.length > 0 && (
            <ul className="cfg-rules">
              {fw.rules.map((r) => (
                <li key={r.name}>
                  <span
                    className="cfg-rule-mark"
                    data-tone={r.present ? 'gain' : r.present === false ? 'loss' : undefined}
                  >
                    {r.present ? '✓' : r.present === false ? '✗' : '?'}
                  </span>
                  {r.name}
                </li>
              ))}
            </ul>
          )}
          {fw.powershellCommands.length > 0 && (
            <CodeBlock
              label={uiText('PowerShell como administrador')}
              code={fw.powershellCommands.join('\n')}
            />
          )}
          {fw.netshCommands.length > 0 && (
            <CodeBlock
              label={uiText('Alternativa (prompt de administrador)')}
              code={fw.netshCommands.join('\n')}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function RemoteSection({ status, onChange }: { status: ApiStatus; onChange: () => void }) {
  const lan = useFetch('lan', () => api.lan());
  return (
    <Panel
      id="acesso-remoto"
      title={uiText('Abrir no celular ou tablet')}
      description={uiText('Funciona pela rede local, sem instalar nada.')}
    >
      <div className="cfg-lan" id={rowDomId('open-phone')}>
        <div className="cfg-lan-urls">
          {lan.error ? (
            <ErrorBox error={lan.error} compact onRetry={lan.reload} />
          ) : !lan.data ? (
            <Loading />
          ) : lan.data.urls.length === 0 ? (
            <p className="cfg-hint">
              {uiText(
                'Nenhum endereço de rede disponível. Conecte o PC e o aparelho à mesma rede local.',
              )}
            </p>
          ) : (
            <>
              <p className="cfg-lead">
                {uiText(
                  'Escaneie o QR Code com a câmera do aparelho ou abra um dos endereços no navegador. Os dois precisam estar na mesma rede.',
                )}
              </p>
              <ul className="cfg-urls">
                {lan.data.urls.map((u) => (
                  <li key={u}>
                    <a href={u} className="num">
                      {u}
                    </a>
                    {u === lan.data?.preferredUrl?.split('?')[0] && (
                      <span className="ui-badge" data-tone="accent">
                        {uiText('preferida')}
                      </span>
                    )}
                    <CopyBtn text={u} />
                  </li>
                ))}
              </ul>
              <p className="cfg-hint">
                {`${uiText(
                  'Se o navegador oferecer “Adicionar à tela inicial”, use para abrir em tela cheia. Neste PC:',
                )} `}
                <span className="num">{lan.data.localUrl}</span>
              </p>
            </>
          )}
        </div>
        {lan.data?.qrSvgDataUrl && (
          <img
            className="cfg-qr"
            src={lan.data.qrSvgDataUrl}
            alt={uiText('QR Code para abrir o ao vivo em outro aparelho')}
          />
        )}
      </div>
      <FirewallBlock status={status} onChange={onChange} />
    </Panel>
  );
}

export function PanelGroup({
  status,
  onChange,
  expandMine,
}: {
  status: ApiStatus;
  onChange: () => void;
  expandMine?: boolean;
}) {
  return (
    <>
      <DevicesSection expandMine={expandMine} />
      <RemoteSection status={status} onChange={onChange} />
    </>
  );
}
