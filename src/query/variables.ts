import type { ScopedVars } from '@grafana/data';
import type { TemplateSrv } from '@grafana/runtime';

/** ScopeQL uses backslash escapes in string literals and backtick identifiers. */
export function quoteScopeQL(value: string, quote = "'"): string {
  return (
    quote +
    Array.from(value, (char) => {
      if (char === quote || char === '\\') {
        return '\\' + char;
      }
      const code = char.charCodeAt(0);
      return code < 32 ? '\\x' + code.toString(16).padStart(2, '0') : char;
    }).join('') +
    quote
  );
}

export function formatVariable(value: unknown, format = 'string'): string {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) {
    throw new Error('Variable has no values; choose a value before running the query');
  }
  if (!['string', 'number', 'identifier'].includes(format)) {
    throw new Error(`Unsupported variable format :${format}; use :string, :number or :identifier`);
  }
  if (format === 'identifier' && values.length !== 1) {
    throw new Error('Identifier variables require exactly one value');
  }
  return values
    .map((item) => {
      if (item == null || !['string', 'number', 'boolean'].includes(typeof item)) {
        throw new Error('Variable values must be scalars');
      }
      const text = String(item);
      if (format === 'number') {
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) || !Number.isFinite(Number(text))) {
          throw new Error('Numeric variable contains an invalid number');
        }
        return text;
      }
      if (format === 'identifier' && !text) {
        throw new Error('Identifier variable cannot be empty');
      }
      return quoteScopeQL(text, format === 'identifier' ? '`' : "'");
    })
    .join(', ');
}

export function interpolateVariables(text: string, scopedVars: ScopedVars, templates: TemplateSrv): string {
  let result = '';
  for (let i = 0; i < text.length;) {
    const start = i;
    if (["'", '"', '`'].includes(text[i])) {
      const quote = text[i++];
      while (i < text.length) {
        if (text[i] === '\\') {
          i += Math.min(2, text.length - i);
          continue;
        }
        if (text[i++] === quote) {
          if (text[i] === quote) {
            i++;
            continue;
          }
          break;
        }
      }
      result += text.slice(start, i);
      continue;
    }
    if (text.startsWith('--', i)) {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      result += text.slice(start, i);
      continue;
    }
    if (text.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < text.length && depth) {
        if (text.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (text.startsWith('*/', i)) {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      result += text.slice(start, i);
      continue;
    }
    const match = text.slice(i).match(/^\$(?:\{([A-Za-z_][A-Za-z_0-9]*)(?::([A-Za-z]+))?\}|([A-Za-z_][A-Za-z_0-9]*))/);
    if (match) {
      const name = match[1] ?? match[3];
      if (name.startsWith('__')) {
        result += match[0];
        i += match[0].length;
        continue;
      }
      const variable = templates.getVariables().find((v) => v.name === name);
      if (variable && 'allValue' in variable && variable.allValue) {
        throw new Error(`Variable ${name}: leave Custom all value blank to expand All safely`);
      }
      let resolved = false;
      const value = templates.replace('${' + name + '}', scopedVars, (raw: unknown) => {
        resolved = true;
        return formatVariable(raw, match[2]);
      });
      if (!resolved) {
        throw new Error(`Unknown or empty Dashboard variable: ${name}`);
      }
      result += value;
      i += match[0].length;
      continue;
    }
    result += text[i++];
  }
  return result;
}
