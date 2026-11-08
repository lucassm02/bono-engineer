/**
 * @gt7/mcp — MCP server (stdio + Streamable HTTP) exposing sessions, laps, per-corner comparisons,
 * consistency, microsectors, traces, evolution, chart images (PNG) and coaching prompts (pt-BR).
 */

export const MCP_PACKAGE = '@gt7/mcp';

export {
  buildComparisonChart,
  type ComparisonChartInput,
  type ComparisonChartRequest,
  type ComparisonChartResult,
  deltaColor,
  renderComparisonSvg,
  svgToPng,
} from './chart.ts';
export { latestDrivingSession } from './format.ts';
export { MCP_HTTP_PATH, type MountMcpHttpOptions, mountMcpHttp } from './http.ts';
export {
  COACH_PERSONA,
  cornerFocusTask,
  debriefTask,
  registerPrompts,
  trainingPlanTask,
} from './prompts.ts';
export {
  createGt7McpServer,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  type McpDeps,
} from './server.ts';
