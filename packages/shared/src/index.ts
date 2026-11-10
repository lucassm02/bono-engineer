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
export * from './domain.ts';
export * from './driver.ts';
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
export * from './live.ts';
export * from './radio/index.ts';
export * from './telemetry.ts';
export * from './tracks/index.ts';
export * from './ui.ts';
export * from './ws.ts';
export type {
  DesktopDiscordBridge,
  DesktopDiscordSettings,
  DesktopDiscordStatus,
} from './desktop-discord.ts';
