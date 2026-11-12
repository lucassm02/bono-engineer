import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLanguage, type Language } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { CONFIG_GROUP_IDS } from '../analysis/lib/configNav.ts';
import {
  articleWords,
  CONFIG_GROUP_HELP,
  HELP_ARTICLE_MAX_WORDS,
  HELP_TOPIC_IDS,
  helpContent,
  searchHelp,
} from './helpContent.ts';
import { RADIO_VOICES, voiceLabel } from './radioVoices.ts';
import { parseRoute } from './route.ts';

const LANGUAGES: Language[] = ['pt-BR', 'en', 'es'];
const SRC = fileURLToPath(new URL('..', import.meta.url));

describe('help content', () => {
  for (const language of LANGUAGES) {
    const content = helpContent(language);

    it(`${language}: every topic exists once and has at least one article`, () => {
      expect(content.topics.map((t) => t.id)).toEqual([...HELP_TOPIC_IDS]);
      for (const topic of content.topics) {
        expect(
          content.articles.some((a) => a.topic === topic.id),
          topic.id,
        ).toBe(true);
      }
    });

    it(`${language}: articles are short, unique and complete`, () => {
      expect(new Set(content.articles.map((a) => a.id)).size).toBe(content.articles.length);
      for (const a of content.articles) {
        expect(a.title.length, a.id).toBeGreaterThan(0);
        expect(a.summary.length, a.id).toBeGreaterThan(0);
        expect(articleWords(a), `${a.id} has ${articleWords(a)} words`).toBeLessThanOrEqual(
          HELP_ARTICLE_MAX_WORDS,
        );
        expect(a.steps || a.items || a.shortcuts, a.id).toBeTruthy();
      }
    });

    it(`${language}: every link goes to a real route`, () => {
      for (const a of content.articles) {
        for (const l of a.links ?? []) {
          expect(l.label.length, a.id).toBeGreaterThan(0);
          expect(l.href.startsWith('#/'), l.href).toBe(true);
          expect(parseRoute(l.href).name, `${a.id} → ${l.href}`).not.toBe('notFound');
        }
      }
    });

    it(`${language}: names the voices by number and never by a first name`, () => {
      const text = JSON.stringify(content);
      for (const voice of RADIO_VOICES.filter((v) => v.language === language)) {
        expect(text).not.toMatch(new RegExp(`\b${voice.name}\b`));
      }
      const voices = content.articles.find((a) => a.id === 'escolher-a-voz');
      const labels = RADIO_VOICES.filter((v) => v.language === language).map(voiceLabel);
      for (const label of labels) {
        expect(
          voices?.items?.some((i) => i.startsWith(label)),
          label,
        ).toBe(true);
      }
    });
  }

  it('has the same articles, in the same order, in the three languages', () => {
    const ids = (l: Language) => helpContent(l).articles.map((a) => `${a.topic}/${a.id}`);
    expect(ids('en')).toEqual(ids('pt-BR'));
    expect(ids('es')).toEqual(ids('pt-BR'));
  });

  it('gives every Settings group a help topic that exists', () => {
    for (const group of CONFIG_GROUP_IDS) {
      expect(HELP_TOPIC_IDS, group).toContain(CONFIG_GROUP_HELP[group]);
    }
  });

  it('knows the three languages of the app', () => {
    expect(LANGUAGES.every(isLanguage)).toBe(true);
  });
});

describe('help search', () => {
  const pt = helpContent('pt-BR').articles;

  it('ignores accents and case, in title and body', () => {
    expect(searchHelp('FIREWALL', pt).map((a) => a.id)).toContain('sem-sinal');
    expect(searchHelp('conexao', pt).length).toBeGreaterThan(0);
    expect(searchHelp('configuracoes', pt).length).toBeGreaterThan(0);
    expect(searchHelp('engenheiro mudo', pt)[0]?.id).toBe('engenheiro-mudo');
  });

  it('wants every word, and answers nothing for an empty or unknown query', () => {
    expect(searchHelp('', pt)).toEqual([]);
    expect(searchHelp('   ', pt)).toEqual([]);
    expect(searchHelp('xyzzy', pt)).toEqual([]);
    expect(searchHelp('token firewall', pt)).toEqual([]);
  });

  it('puts the title matches first', () => {
    const hits = searchHelp('discord', pt);
    expect(hits[0]?.title.toLowerCase()).toContain('discord');
  });
});

describe('help in the screens', () => {
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) sourceFiles(path, out);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
    }
    return out;
  }

  it('has the sidebar anchor the tour points at', () => {
    const all = sourceFiles(SRC)
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    expect(all).toMatch(/tour:\s*'nav-help'/);
  });
});
