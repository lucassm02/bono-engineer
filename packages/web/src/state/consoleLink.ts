/** Console link state for components: server status, or the simulated one in the demo. */

import type { ConsoleConnection } from '@gt7/shared';
import { useUi } from './uiStore.ts';

export function useConsoleConnection(): ConsoleConnection | null {
  return useUi((s) =>
    s.source === 'mock' ? s.mockConnection : (s.serverStatus?.consoleConnection ?? null),
  );
}

export function openConnectionPanel(): void {
  useUi.setState({ connectionPanelOpen: true });
}

export function closeConnectionPanel(): void {
  useUi.setState({ connectionPanelOpen: false });
}
