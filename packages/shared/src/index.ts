/**
 * @gt7/shared — typed contracts shared by every package (isomorphic: no Node or DOM APIs).
 *
 * File ownership for parallel work: telemetry.ts (protocol), live.ts (core), domain.ts (core),
 * analysis.ts (analysis), ws.ts / api.ts / coach.ts (server), ui.ts (web),
 * radio/ (radio engineer decision engine).
 */

export * from './analysis.ts';
export * from './api.ts';
export * from './brand.ts';
export * from './cars/index.ts';
export * from './coach.ts';
export * from './corner-loss.ts';
export * from './daily-races.ts';
export type {
  DesktopDataBridge,
  DesktopDataCurrent,
  DesktopDataFolderInfo,
  DesktopDataMode,
} from './desktop-data.ts';
export {
  type DesktopDiscordBridge,
  type DesktopDiscordSettings,
  type DesktopDiscordStatus,
  type DesktopDiscordSummary,
  DISCORD_BOT_PERMISSIONS,
  DISCORD_DEFAULT_DELAY_MS,
  DISCORD_PORTAL_URL,
  DISCORD_RADIO_DEVICE_ID,
  type DiscordBotInfo,
  type DiscordVoiceChannel,
  EMPTY_DISCORD_CONFIG,
  migrateDiscordConfig,
  type StoredDiscordConfig,
} from './desktop-discord.ts';
export * from './domain.ts';
export * from './drill.ts';
export * from './driver.ts';
export * from './goals.ts';
export {
  ALL_DIAGNOSTIC_CODES,
  type CarClassKnowledge,
  COACH_RULES,
  DIAGNOSTICS,
  type DiagnosticCode,
  type DiagnosticKnowledge,
  diagnosticFor,
  KNOWLEDGE_MAX_CHARS,
  KNOWLEDGE_SOURCES,
  type KnowledgeBrief,
  type KnowledgeQuery,
  type KnowledgeSource,
  knowledgeBrief,
  knowledgeFor,
  knowledgeFullMarkdown,
  knowledgeIndex,
  knowledgeIndexMarkdown,
  knowledgeStats,
  knowledgeTopic,
  parseCarGroup,
  resolveTopicId,
  searchKnowledge,
  type TopicRef,
} from './knowledge/index.ts';
export * from './language.ts';
export * from './live.ts';
export * from './map-overlay.ts';
export * from './pace-trend.ts';
export * from './pit-plan.ts';
export * from './radio/index.ts';
export { localizedRadioUtterance } from './radio-translations.ts';
export * from './summary-text.ts';
export * from './tasks.ts';
export * from './telemetry.ts';
export * from './track-context.ts';
export * from './tracks/index.ts';
export * from './ui.ts';
export * from './weekly-text.ts';
export * from './ws.ts';
