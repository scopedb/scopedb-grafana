import type { TemplateSrv } from '@grafana/runtime';
import { formatVariable, interpolateVariables, quoteScopeQL } from './variables';

function template(value: unknown, allValue?: string): TemplateSrv {
  return {
    getVariables: () => [{ name: 'value', type: 'query', allValue }],
    replace: (_text: string, _scope: unknown, format: (value: unknown) => string) => format(value),
  } as unknown as TemplateSrv;
}

test('ScopeQL strings and identifiers escape quotes, backslashes and control characters', () => {
  expect(formatVariable("O'Reilly\\path\n")).toBe("'O\\'Reilly\\\\path\\x0a'");
  expect(formatVariable(['en', "x'); DROP TABLE events; --"])).toBe("'en', 'x\\'); DROP TABLE events; --'");
  expect(quoteScopeQL('odd`table', '`')).toBe('`odd\\`table`');
  expect(formatVariable('db.table', 'identifier')).toBe('`db.table`');
});

test('numeric variables cannot inject ScopeQL or silently become infinity', () => {
  for (const value of ['1; SELECT 2', 'NaN', 'Infinity', '1e999', '', '0x10']) {
    expect(() => formatVariable(value, 'number')).toThrow('invalid number');
  }
  expect(formatVariable(['12', '-1.25e2'], 'number')).toBe('12, -1.25e2');
  expect(() => formatVariable(['a', 'b'], 'identifier')).toThrow('exactly one');
  expect(() => formatVariable('anything', 'raw')).toThrow('Unsupported');
  expect(() => formatVariable([])).toThrow('no values');
});

test('interpolates only unquoted variables and preserves backend macros and positional columns', () => {
  const query =
    "SELECT $value, ${value:string}, '$value', `$value`, $0 -- $value\n/* $value */ WHERE $__timeFilter(time)";
  expect(interpolateVariables(query, {}, template('safe'))).toBe(
    "SELECT 'safe', 'safe', '$value', `$value`, $0 -- $value\n/* $value */ WHERE $__timeFilter(time)"
  );
  expect(interpolateVariables('contains([${value}], language::any)', {}, template(['en', 'ja']))).toBe(
    "contains(['en', 'ja'], language::any)"
  );
});

test('All expands its values and rejects raw custom All and unresolved variables', () => {
  expect(interpolateVariables('${value:number}', {}, template([1, 2]))).toBe('1, 2');
  expect(() => interpolateVariables('$value', {}, template(['en'], '.*'))).toThrow('Custom all');
  const unknown = { getVariables: () => [], replace: (text: string) => text } as unknown as TemplateSrv;
  expect(() => interpolateVariables('$missing', {}, unknown)).toThrow('Unknown');
});
