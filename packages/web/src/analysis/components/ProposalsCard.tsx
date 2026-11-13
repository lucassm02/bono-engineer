/**
 * Início: "Propostas do agente". An AI agent (MCP) or the in-app coach suggested instructions for
 * the radio engineer; nothing is said until the driver approves. Only shown while there are proposals.
 */

import { t as uiText } from '../../lib/i18n.ts';
import { routes } from '../../lib/route.ts';
import { useTasks } from '../../state/tasks.ts';
import { api } from '../api.ts';
import { fullTrackName } from '../lib/history.ts';
import { useFetch } from '../useFetch.ts';
import { Panel } from './Panel.tsx';
import { TaskRow } from './TasksTab.tsx';

export function ProposalsCard() {
  const count = useTasks((s) => s.proposals);
  const list = useFetch(`task-proposals:${count}`, () => api.tasks({ status: 'proposed' }), 20000);
  const tracks = useFetch('task-proposal-tracks', () => api.tracks());
  const proposals = list.data?.tasks ?? [];
  if (proposals.length === 0) return null;
  const names = new Map((tracks.data ?? []).map((t) => [t.id, fullTrackName(t)]));
  const trackIds = [...new Set(proposals.map((p) => p.trackId))];
  return (
    <Panel
      tone="accent"
      title={uiText('Propostas do agente ({0})', proposals.length)}
      description={uiText(
        'Um agente de IA sugeriu instruções para o engenheiro falar na pista. Nada é falado até você aprovar.',
      )}
      actions={
        trackIds.length === 1 ? (
          <a
            className="ui-btn"
            data-variant="secondary"
            data-size="sm"
            href={routes.track(trackIds[0]!, { tab: 'tarefas' })}
          >
            {uiText('Abrir na pista')}
          </a>
        ) : undefined
      }
    >
      <ul className="tk-list">
        {proposals.slice(0, 6).map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            trackLabel={names.get(task.trackId) ?? undefined}
            onChanged={list.reload}
          />
        ))}
      </ul>
      {proposals.length > 6 && (
        <p className="dim a-small">
          {uiText('E mais {0}. Abra a pista para ver todas.', proposals.length - 6)}
        </p>
      )}
    </Panel>
  );
}
