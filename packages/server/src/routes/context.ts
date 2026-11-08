/**
 * What every REST route module receives. New route files (e.g. a later `/api/analysis/*` wave
 * using AnalysisService) take the same context and are added to `routes/index.ts`.
 */

import type { Gt7Runtime } from '@gt7/core';
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
}
