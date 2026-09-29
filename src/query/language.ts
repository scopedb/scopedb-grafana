import type { Monaco } from '@grafana/ui';

export const keywords = [
  'FROM',
  'WHERE',
  'SELECT',
  'GROUP BY',
  'AGGREGATE',
  'ORDER BY',
  'LIMIT',
  'AS',
  'AND',
  'OR',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
];
export function registerLanguage(monaco: Monaco) {
  if (monaco.languages.getLanguages().some((lang) => lang.id === 'scopeql')) {
    return;
  }
  monaco.languages.register({ id: 'scopeql' });
  monaco.languages.setMonarchTokensProvider('scopeql', {
    ignoreCase: true,
    keywords: keywords.flatMap((k) => k.split(' ')),
    tokenizer: {
      root: [
        [/--.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/'(?:[^'\\]|\\.)*'/, 'string'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/`(?:[^`\\]|\\.)*`/, 'identifier'],
        [/\$\{[^}]+\}|\$[A-Za-z_][\w]*/, 'variable'],
        [/[a-zA-Z_][\w]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/\d+(?:\.\d+)?/, 'number'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
  });
}
