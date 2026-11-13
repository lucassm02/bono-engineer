/**
 * Driving knowledge base over MCP: tool `get_knowledge` and resources `gt7://knowledge[/{topic}]`.
 * Same data and renderer as the in-app coach and the "Guia de pilotagem" page
 * (`@gt7/shared` knowledge module), so every client coaches from the same base.
 */

import type { Gt7Store } from '@gt7/core';
import {
  KNOWLEDGE_MAX_CHARS,
  knowledgeBrief,
  knowledgeIndex,
  knowledgeIndexMarkdown,
  knowledgeTopic,
  parseCarGroup,
} from '@gt7/shared';
import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { latestDrivingSession } from './format.ts';

const INDEX_WORDS = new Set(['indice', 'índice', 'index', 'topicos', 'tópicos']);

function text(t: string, isError = false): CallToolResult {
  return { ...(isError ? { isError: true } : {}), content: [{ type: 'text', text: t }] };
}

export function registerKnowledge(server: McpServer, deps: { store: Gt7Store }): void {
  const { store } = deps;

  server.registerTool(
    'get_knowledge',
    {
      title: 'Base de conhecimento de pilotagem',
      description:
        'Conhecimento de pilotagem em pt-BR, por classe de carro (Gr.1, Gr.2, Gr.3, Gr.4, Gr.B, N, X) e por ' +
        'diagnóstico do app: significado, causa provável, ação, exercício e variação por classe, mais ' +
        'princípios gerais, afinação (sintoma → ajuste), glossário e fontes. Chame DEPOIS de compare_laps ' +
        'com car_code e diagnostics = os códigos de plan[].code. Sem argumentos devolve o resumo do ' +
        'carro da sessão mais recente. topic="index" lista os tópicos; topic="gr4", "brakeEarlier", ' +
        '"setup", "glossary", "sources" devolve a página completa. A base NÃO tem pontos de frenagem ' +
        'por pista: só princípios; cada afirmação diz se é regra geral ou depende do carro.',
      inputSchema: {
        topic: z
          .string()
          .optional()
          .describe(
            'Página completa: "index", "general/trail-braking", "class/gr4" (ou "gr4"), "diagnostics/brakeEarlier" (ou o código), "setup", "glossary", "sources".',
          ),
        car_code: z
          .number()
          .int()
          .optional()
          .describe('Código do carro (carCode): a classe sai do catálogo.'),
        car_group: z
          .string()
          .optional()
          .describe('Grupo do carro se não houver car_code: 1, 2, 3, 4, B, N ou X.'),
        diagnostics: z
          .array(z.string())
          .max(12)
          .optional()
          .describe(
            'Códigos de diagnóstico presentes (plan[].code), mais custosos primeiro (até 6 usados).',
          ),
        corner_kind: z
          .string()
          .optional()
          .describe('Tipo da curva: hairpin, slow, medium, fast, kink ou chicane.'),
        track_id: z
          .string()
          .optional()
          .describe('Id da pista (só contexto; não há dados por pista).'),
        max_chars: z
          .number()
          .int()
          .min(1200)
          .max(8000)
          .default(KNOWLEDGE_MAX_CHARS)
          .describe('Limite de tamanho do resumo em caracteres (padrão 6000).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ topic, car_code, car_group, diagnostics, corner_kind, track_id, max_chars }) => {
      try {
        if (topic !== undefined && topic.trim() !== '') {
          if (INDEX_WORDS.has(topic.trim().toLowerCase())) return text(knowledgeIndexMarkdown());
          const md = knowledgeTopic(topic, { group: car_group ?? null });
          if (md) return text(md);
          return text(
            `Tópico "${topic}" não existe. Use topic="index" para ver os disponíveis.\n\n${knowledgeIndexMarkdown()}`,
            true,
          );
        }
        let carCode = car_code;
        let note = '';
        if (
          carCode === undefined &&
          parseCarGroup(car_group) === null &&
          (diagnostics?.length ?? 0) === 0
        ) {
          const s = latestDrivingSession(store);
          if (s) {
            carCode = s.carCode;
            note = `\n\n_Carro da sessão mais recente (${s.id}). Passe car_code/diagnostics para ser específico, ou topic="index" para ver os tópicos._`;
          }
        }
        const brief = knowledgeBrief({
          carCode,
          carGroup: car_group,
          diagnosticCodes: diagnostics,
          cornerKind: corner_kind,
          trackId: track_id,
          maxChars: max_chars,
        });
        return text(brief.markdown + note);
      } catch (e) {
        return text(`Erro: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    },
  );

  server.registerResource(
    'knowledge',
    'gt7://knowledge',
    {
      title: 'Base de conhecimento de pilotagem',
      description: 'Índice dos tópicos da base de pilotagem (Markdown, pt-BR).',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: knowledgeIndexMarkdown() }],
    }),
  );

  server.registerResource(
    'knowledge-topic',
    new ResourceTemplate('gt7://knowledge/{+topic}', {
      list: async () => ({
        resources: knowledgeIndex().map((t) => ({
          uri: `gt7://knowledge/${t.id}`,
          name: t.title,
          description: t.summary,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    {
      title: 'Tópico de pilotagem',
      description:
        'Página de um tópico: general/<id>, class/gr1…grx, diagnostics/<code>, setup, glossary, sources.',
      mimeType: 'text/markdown',
    },
    async (uri, vars) => {
      const id = decodeURIComponent(String(vars.topic));
      const md = knowledgeTopic(id);
      if (!md) throw new Error(`Tópico ${id} não encontrado.`);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: md }] };
    },
  );
}
