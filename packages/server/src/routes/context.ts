/**
 * What every REST route module receives (route files are listed in `routes/index.ts`).
 */

import type { Gt7Runtime } from '@gt7/core';
import type { CoachService } from '../coach/service.ts';
import type { FirewallChecker } from '../firewall.ts';
import type { WsHub } from '../hub.ts';
import type { LanResolver } from '../lan.ts';

export interface RouteContext {
  runtime: Gt7Runtime;
  hub: WsHub;
  lan: LanResolver;
  firewall: FirewallChecker;
  httpPort: number;
  tokenRequired: boolean;
  /** Demo mode (in-process fake console). */
  simulator: boolean;
  /** In-app AI coach (Debrief com IA). */
  coach: CoachService;
  /** Bundled MCP stdio server of the desktop app; null/missing = the repo's stdio.ts. */
  mcpStdioScript?: string | null;
}
