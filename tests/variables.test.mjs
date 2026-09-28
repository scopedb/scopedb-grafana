import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatVariable, interpolateVariables, quoteScopeQL } from '../src/variables.ts';

const templates = (value, allValue) => ({
  getVariables: () => [{ name: 'value', type: 'query', allValue }],
  replace: (_text, _scope, format) => format(value),
});

test('quotes strings, identifiers and lists without accepting raw input', () => {
  assert.equal(formatVariable("O'Reilly\\path\n"), "'O\\'Reilly\\\\path\\x0a'");
  assert.equal(formatVariable(['en', "x'); DROP TABLE events; --"]), "'en', 'x\\'); DROP TABLE events; --'");
  assert.equal(quoteScopeQL('odd`table', '`'), '`odd\\`table`');
  assert.equal(formatVariable('db.table', 'identifier'), '`db.table`');
  assert.throws(() => formatVariable(['a', 'b'], 'identifier'), /exactly one/);
  assert.throws(() => formatVariable('anything', 'raw'), /Unsupported/);
  assert.throws(() => formatVariable([]), /no values/);
});

test('numeric values reject injection and overflow without losing integer precision', () => {
  for (const value of ['1; SELECT 2', 'NaN', 'Infinity', '1e999', '', '0x10']) {
    assert.throws(() => formatVariable(value, 'number'), /invalid number/);
  }
  assert.equal(
    formatVariable(['12', '-1.25e2', '18446744073709551615'], 'number'),
    '12, -1.25e2, 18446744073709551615'
  );
});

test('interpolates variables outside literals and comments, preserving macros', () => {
  const query =
    "SELECT $value, ${value:string}, '$value', `$value`, $0 -- $value\n/* $value */ WHERE $__timeFilter(time)";
  assert.equal(
    interpolateVariables(query, {}, templates('safe')),
    "SELECT 'safe', 'safe', '$value', `$value`, $0 -- $value\n/* $value */ WHERE $__timeFilter(time)"
  );
  assert.equal(
    interpolateVariables('contains([${value}], language::any)', {}, templates(['en', 'ja'])),
    "contains(['en', 'ja'], language::any)"
  );
  assert.equal(interpolateVariables('${value:number}', {}, templates([1, 2])), '1, 2');
  assert.throws(() => interpolateVariables('$value', {}, templates(['en'], '.*')), /Custom all/);
  assert.throws(
    () =>
      interpolateVariables(
        '$missing',
        {},
        {
          getVariables: () => [],
          replace: (text) => text,
        }
      ),
    /Unknown/
  );
});
