import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CatalogController } from '../src/catalog/controller.ts';

const items = (...names) => names.map((name) => ({ name }));
const columns = [
  { name: 'received_at', data_type: 'timestamp' },
  { name: 'created_at', data_type: 'timestamp' },
  { name: 'message', data_type: 'string' },
];
function fixture() {
  const calls = [];
  const client = {
    async catalog(level, params) {
      calls.push({ level, ...params });
      return {
        databases: items('other', 'scopedb'),
        schemas: items('custom', 'public'),
        tables: items('events', 'logs'),
      }[level];
    },
    async columns(database, schema, table) {
      calls.push({ level: 'columns', database, schema, table });
      return columns;
    },
  };
  return { client, calls, catalog: new CatalogController(client) };
}

test('loads conventional defaults but waits for an explicit table selection', async () => {
  const { catalog, calls } = fixture();
  await catalog.refresh();
  assert.equal(catalog.getSnapshot().database, 'scopedb');
  assert.equal(catalog.getSnapshot().schema, 'public');
  assert.equal(catalog.getSnapshot().table, '');
  assert.deepEqual(
    calls.map((call) => call.level),
    ['databases', 'schemas', 'tables']
  );
  await catalog.selectTable('events');
  assert.equal(catalog.getSnapshot().timeColumn, 'received_at');
});

test('refresh preserves custom database, schema, table and time column, including a cleared time filter', async () => {
  const { catalog } = fixture();
  await catalog.refresh();
  await catalog.selectDatabase('other');
  await catalog.selectSchema('custom');
  await catalog.selectTable('events');
  catalog.selectTimeColumn('created_at');
  await catalog.refresh();
  const state = catalog.getSnapshot();
  assert.deepEqual(
    [state.database, state.schema, state.table, state.timeColumn],
    ['other', 'custom', 'events', 'created_at']
  );
  catalog.selectTimeColumn('');
  await catalog.refresh();
  assert.equal(catalog.getSnapshot().timeColumn, '');
});

test('retry resumes the failed catalog level without discarding completed parent selections', async () => {
  for (const failure of ['databases', 'schemas', 'tables', 'columns']) {
    const { catalog, client, calls } = fixture();
    await catalog.refresh();
    await catalog.selectTable('events');
    const original = failure === 'columns' ? client.columns : client.catalog;
    let fail = true;
    const method = failure === 'columns' ? 'columns' : 'catalog';
    client[method] = async (...args) => {
      if (fail && (failure === 'columns' || args[0] === failure)) {
        throw { data: { message: 'Temporary catalog failure' } };
      }
      return original(...args);
    };
    await catalog.refresh();
    assert.equal(catalog.getSnapshot().error, 'Temporary catalog failure');
    assert.equal(catalog.getSnapshot().loading, undefined);
    if (failure === 'columns') {
      assert.equal(catalog.getSnapshot().table, 'events');
      assert.deepEqual(catalog.getSnapshot().tables, items('events', 'logs'));
    }
    fail = false;
    calls.length = 0;
    await catalog.retry();
    assert.equal(calls[0].level, failure);
    assert.equal(catalog.getSnapshot().error, undefined);
    assert.equal(catalog.getSnapshot().table, 'events');
    assert.equal(catalog.getSnapshot().timeColumn, 'received_at');
  }
});

test('empty databases and schemas stop loading their descendants', async () => {
  for (const emptyLevel of ['databases', 'schemas', 'tables']) {
    const { catalog, client, calls } = fixture();
    const original = client.catalog;
    client.catalog = async (level, params) => (level === emptyLevel ? [] : original(level, params));
    await catalog.refresh();
    assert.equal(catalog.getSnapshot().loaded, true);
    assert.equal(catalog.getSnapshot().loading, undefined);
    assert.equal(catalog.getSnapshot().error, undefined);
    assert.deepEqual(catalog.getSnapshot()[emptyLevel], []);
    assert.equal(calls.length, ['databases', 'schemas', 'tables'].indexOf(emptyLevel));
  }
});

test('refresh clears a removed table and selects a remaining timestamp if the selected column disappeared', async () => {
  const { catalog, client } = fixture();
  await catalog.refresh();
  await catalog.selectTable('events');
  catalog.selectTimeColumn('created_at');
  client.columns = async () => columns.slice(0, 1);
  await catalog.refresh();
  assert.equal(catalog.getSnapshot().timeColumn, 'received_at');
  const original = client.catalog;
  client.catalog = async (level, params) => (level === 'tables' ? items('logs') : original(level, params));
  await catalog.refresh();
  assert.equal(catalog.getSnapshot().table, '');
  assert.deepEqual(catalog.getSnapshot().columns, []);
});

test('switching databases clears old table metadata immediately', async () => {
  const { catalog, client } = fixture();
  await catalog.refresh();
  await catalog.selectTable('events');
  const pending = Promise.withResolvers();
  client.catalog = () => pending.promise;
  const loading = catalog.selectDatabase('other');
  assert.equal(catalog.getSnapshot().database, 'other');
  assert.equal(catalog.getSnapshot().table, '');
  assert.deepEqual(catalog.getSnapshot().columns, []);
  pending.resolve([]);
  await loading;
});

test('late success or failure from an old table cannot overwrite a new selection', async () => {
  for (const fail of [false, true]) {
    const { catalog, client } = fixture();
    await catalog.refresh();
    const pending = Promise.withResolvers();
    client.columns = async (_database, _schema, table) => (table === 'events' ? pending.promise : columns.slice(2));
    const old = catalog.selectTable('events');
    await catalog.selectTable('logs');
    if (fail) {
      pending.reject(new Error('Old request failed'));
    } else {
      pending.resolve(columns);
    }
    await old;
    assert.equal(catalog.getSnapshot().table, 'logs');
    assert.equal(catalog.getSnapshot().timeColumn, '');
    assert.deepEqual(catalog.getSnapshot().columns, columns.slice(2));
    assert.equal(catalog.getSnapshot().error, undefined);
  }
});

test('cancellation prevents late notifications and follow-up requests', async () => {
  const { catalog, client, calls } = fixture();
  const pending = Promise.withResolvers();
  client.catalog = () => pending.promise;
  let notifications = 0;
  const unsubscribe = catalog.subscribe(() => notifications++);
  const loading = catalog.refresh();
  assert.equal(notifications, 1);
  catalog.cancel();
  unsubscribe();
  pending.resolve(items('scopedb'));
  await loading;
  assert.equal(notifications, 1);
  assert.deepEqual(calls, []);
  assert.deepEqual(catalog.getSnapshot().databases, []);
});
