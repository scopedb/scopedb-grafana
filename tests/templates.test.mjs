import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildQueryTemplate } from '../src/query/templates.ts';

const table = { database: 'scopedb', schema: 'public', table: 'events', columns: [], timeColumn: 'time' };

test('table template applies the time range, newest-first ordering, and bounded results', () => {
  assert.equal(
    buildQueryTemplate(table, 'table'),
    [
      'FROM `scopedb`.`public`.`events`',
      'WHERE $__timeFilter(`time`)',
      'SELECT *',
      'ORDER BY `time` DESC',
      'LIMIT 1000',
    ].join('\n')
  );
});

test('table queries without a time column remain usable; time series explains the missing prerequisite', () => {
  const untimed = { ...table, timeColumn: '' };
  assert.equal(buildQueryTemplate(untimed, 'table'), 'FROM `scopedb`.`public`.`events`\nSELECT *\nLIMIT 1000');
  assert.throws(() => buildQueryTemplate(untimed, 'time_series'), /Choose a timestamp column/);
});

test('time series groups and orders by the same timestamp within the Grafana range', () => {
  assert.equal(
    buildQueryTemplate(table, 'time_series'),
    [
      'FROM `scopedb`.`public`.`events`',
      'WHERE $__timeFilter(`time`)',
      'SELECT $__timeGroup(`time`) AS time',
      'GROUP BY time AGGREGATE count() AS events',
      'ORDER BY time',
      'LIMIT 10000',
    ].join('\n')
  );
});

test('catalog identifiers are quoted individually, including punctuation and escapes', () => {
  const text = buildQueryTemplate(
    { ...table, database: 'my.db', table: 'odd`table', timeColumn: 'created at' },
    'table'
  );
  assert.ok(text.startsWith('FROM `my.db`.`public`.`odd\\`table`\n'));
  assert.ok(text.includes('$__timeFilter(`created at`)'));
});
