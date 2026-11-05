const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  initializeStorage,
  getStorage,
  getScopedStorage,
  createScopedSupabaseClient,
  setStorage,
  resetStorage,
  SupabaseStorageAdapter
} = require('../storage/taskStore.js');

describe('Storage Isolation & RLS Security Regression Suite', () => {
  const originalEnv = Object.assign({}, process.env);

  afterEach(() => {
    process.env = Object.assign({}, originalEnv);
    resetStorage();
  });

  after(() => {
    process.env = Object.assign({}, originalEnv);
    resetStorage();
  });

  test('1. Production never uses SUPABASE_SERVICE_ROLE_KEY for normal task operations', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SUPABASE_URL = 'https://liucmamlownxfshnaxtc.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'public-anon-key-123';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'SUPER-SECRET-SERVICE-ROLE-KEY-NEVER-USE';

    // Verify createScopedSupabaseClient uses anon key, NOT service role key
    const scopedClient = createScopedSupabaseClient('user-jwt-token-abc');
    assert.strictEqual(scopedClient.supabaseKey, 'public-anon-key-123');
    assert.notStrictEqual(scopedClient.supabaseKey, 'SUPER-SECRET-SERVICE-ROLE-KEY-NEVER-USE');

    // Verify getScopedStorage uses anon key
    const storage = getScopedStorage({ userToken: 'user-jwt-token-abc' });
    assert.strictEqual(storage.client.supabaseKey, 'public-anon-key-123');

    // If SUPABASE_ANON_KEY is missing, it must NOT fall back to SUPABASE_SERVICE_ROLE_KEY
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_KEY;
    assert.throws(
      () => createScopedSupabaseClient('user-jwt-token-abc'),
      /Missing SUPABASE_URL or SUPABASE_ANON_KEY/i
    );
  });

  test('2. Production authenticated requests use a request-scoped client with user Bearer JWT', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SUPABASE_URL = 'https://liucmamlownxfshnaxtc.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'public-anon-key-123';

    const storageUserA = getScopedStorage({ userToken: 'jwt-for-user-A' });
    const storageUserB = getScopedStorage({ userToken: 'jwt-for-user-B' });

    // Clients must be distinct request-scoped instances
    assert.notStrictEqual(storageUserA.client, storageUserB.client);

    // Verify request headers on REST client
    const headerA = storageUserA.client.headers.Authorization || storageUserA.client.rest.headers.get('Authorization');
    const headerB = storageUserB.client.headers.Authorization || storageUserB.client.rest.headers.get('Authorization');

    assert.strictEqual(headerA, 'Bearer jwt-for-user-A');
    assert.strictEqual(headerB, 'Bearer jwt-for-user-B');
  });

  test('3. An initialized activeAdapter cannot bypass request-scoped storage in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SUPABASE_URL = 'https://liucmamlownxfshnaxtc.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'public-anon-key-123';

    // Simulate an activeAdapter previously set (e.g. shared adapter trap)
    const trapAdapter = { isSharedElevatedTrap: true };
    setStorage(trapAdapter, 'supabase');

    // In production, getScopedStorage MUST NOT return trapAdapter
    const scopedStorage = getScopedStorage({ userToken: 'legitimate-user-jwt' });
    assert.strictEqual(scopedStorage.isSharedElevatedTrap, undefined);
    assert.ok(scopedStorage instanceof SupabaseStorageAdapter);
    const authHeader = scopedStorage.client.headers.Authorization || scopedStorage.client.rest.headers.get('Authorization');
    assert.strictEqual(authHeader, 'Bearer legitimate-user-jwt');
  });

  test('4. Two users cannot access or modify each other tasks (SupabaseStorageAdapter CRUD audit)', async () => {
    const mockDb = new Map();

    const mockSupabase = {
      from: () => {
        const filters = [];
        let pendingInsert = null;
        let pendingUpdate = null;
        let isDelete = false;

        const matchesFilters = (row) => filters.every(f => row[f.col] === f.val);

        const builder = {
          select: () => builder,
          order: () => builder,
          eq: (col, val) => {
            filters.push({ col, val });
            return builder;
          },
          insert: (payload) => {
            pendingInsert = Array.isArray(payload) ? payload : [payload];
            return builder;
          },
          update: (payload) => {
            pendingUpdate = payload;
            return builder;
          },
          delete: () => {
            isDelete = true;
            return builder;
          },
          single: async () => {
            const res = await builder;
            return { data: res.data ? res.data[0] : null, error: res.error };
          },
          then: (resolve) => {
            if (pendingInsert) {
              const inserted = [];
              for (const item of pendingInsert) {
                mockDb.set(item.id, Object.assign({}, item));
                inserted.push(item);
              }
              return resolve({ data: inserted, error: null });
            }
            if (pendingUpdate) {
              const updated = [];
              for (const [id, row] of mockDb.entries()) {
                if (matchesFilters(row)) {
                  const newRow = Object.assign({}, row, pendingUpdate);
                  mockDb.set(id, newRow);
                  updated.push(newRow);
                }
              }
              return resolve({ data: updated, error: null });
            }
            if (isDelete) {
              const deleted = [];
              for (const [id, row] of Array.from(mockDb.entries())) {
                if (matchesFilters(row)) {
                  mockDb.delete(id);
                  deleted.push(row);
                }
              }
              return resolve({ data: deleted, error: null });
            }
            const rows = Array.from(mockDb.values()).filter(matchesFilters);
            return resolve({ data: rows, error: null });
          }
        };
        return builder;
      }
    };

    const adapter = new SupabaseStorageAdapter(mockSupabase, 'todos');
    const userA = 'user-uuid-1111';
    const userB = 'user-uuid-2222';

    // A. User A creates a task
    const taskA = await adapter.createTask({
      id: 'task-a-1',
      title: 'User A Secret Task',
      dueDate: '2026-12-01'
    }, userA);
    assert.strictEqual(taskA.id, 'task-a-1');

    // B. User B calls getAllTasks(userB) -> User A task is NOT returned
    const userBTasks = await adapter.getAllTasks(userB);
    assert.strictEqual(userBTasks.length, 0);

    // C. User A calls getAllTasks(userA) -> Task A is returned
    const userATasks = await adapter.getAllTasks(userA);
    assert.strictEqual(userATasks.length, 1);
    assert.strictEqual(userATasks[0].title, 'User A Secret Task');

    // D. User B attempts update on User A's task -> returns null (not modified)
    const updateResult = await adapter.updateTask('task-a-1', { title: 'Hacked by User B' }, userB);
    assert.strictEqual(updateResult, null);
    assert.strictEqual(mockDb.get('task-a-1').title, 'User A Secret Task');

    // E. User B attempts delete on User A's task -> returns false (not deleted)
    const deleteResult = await adapter.deleteTask('task-a-1', userB);
    assert.strictEqual(deleteResult, false);
    assert.ok(mockDb.has('task-a-1'));

    // F. User B calls clearCompleted(userB) when User A task is completed -> User A task NOT deleted
    mockDb.get('task-a-1').completed = true;
    const clearedCount = await adapter.clearCompleted(userB);
    assert.strictEqual(clearedCount, 0);
    assert.ok(mockDb.has('task-a-1'));
  });

  test('5. Missing public Supabase configuration in production fails closed', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_KEY;

    // getScopedStorage with token must fail closed
    assert.throws(
      () => getScopedStorage({ userToken: 'user-jwt' }),
      /Missing public Supabase configuration/i
    );

    // initializeStorage must fail closed
    await assert.rejects(
      () => initializeStorage(),
      /Missing SUPABASE_URL and SUPABASE_ANON_KEY/i
    );

    // Direct getStorage() must fail closed in production
    assert.throws(
      () => getStorage(),
      /Direct un-scoped getStorage\(\) is forbidden in production/i
    );
  });

  test('6. Unauthenticated getScopedStorage in production fails closed', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SUPABASE_URL = 'https://liucmamlownxfshnaxtc.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'public-anon-key-123';

    assert.throws(
      () => getScopedStorage(null),
      /Unauthenticated storage access is prohibited in production/i
    );

    assert.throws(
      () => getScopedStorage({}),
      /Unauthenticated storage access is prohibited in production/i
    );
  });

  test('7. Missing or invalid userId throws immediately for getAllTasks without querying database', async () => {
    let queryIssued = false;
    const spyClient = {
      from: () => {
        queryIssued = true;
        return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [] }) }) }) };
      }
    };
    const adapter = new SupabaseStorageAdapter(spyClient, 'todos');

    await assert.rejects(() => adapter.getAllTasks(), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.getAllTasks(null), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.getAllTasks(undefined), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.getAllTasks(''), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.getAllTasks('   '), /Mandatory userId is missing/i);
    assert.strictEqual(queryIssued, false, 'No database query must be issued when userId is missing');
  });

  test('8. Missing or invalid userId throws immediately for createTask without querying database', async () => {
    let queryIssued = false;
    const spyClient = {
      from: () => {
        queryIssued = true;
        return { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: {} }) }) }) };
      }
    };
    const adapter = new SupabaseStorageAdapter(spyClient, 'todos');
    const validTodo = { id: 'task-test', title: 'Task Title' };

    await assert.rejects(() => adapter.createTask(validTodo), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.createTask(validTodo, null), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.createTask(validTodo, undefined), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.createTask(validTodo, ''), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.createTask(validTodo, '   '), /Mandatory userId is missing/i);
    assert.strictEqual(queryIssued, false, 'No database query must be issued when userId is missing');
  });

  test('9. createTask assigns authenticated userId and ignores spoofed todo.user_id or todo.userId in body', async () => {
    let insertedPayload = null;
    const spyClient = {
      from: () => ({
        insert: (payload) => {
          insertedPayload = payload;
          return {
            select: () => ({
              single: () => Promise.resolve({ data: Object.assign({}, payload), error: null })
            })
          };
        }
      })
    };
    const adapter = new SupabaseStorageAdapter(spyClient, 'todos');

    // Attacker sends spoofed body with victim user_id
    const spoofedTodo = {
      id: 'task-spoof-1',
      title: 'Spoofed Task',
      user_id: 'victim-uuid-666',
      userId: 'victim-uuid-777'
    };
    const realAuthUserId = 'authenticated-user-uuid-999';

    const result = await adapter.createTask(spoofedTodo, realAuthUserId);
    assert.strictEqual(insertedPayload.user_id, realAuthUserId, 'Payload user_id must be assigned from authenticated argument');
    assert.notStrictEqual(insertedPayload.user_id, 'victim-uuid-666');
    assert.notStrictEqual(insertedPayload.user_id, 'victim-uuid-777');
  });

  test('10. Missing or invalid userId throws immediately for updateTask without querying database', async () => {
    let queryIssued = false;
    const spyClient = {
      from: () => {
        queryIssued = true;
        return { update: () => ({ eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [] }) }) }) }) };
      }
    };
    const adapter = new SupabaseStorageAdapter(spyClient, 'todos');

    await assert.rejects(() => adapter.updateTask('id-1', { title: 'New' }), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.updateTask('id-1', { title: 'New' }, null), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.updateTask('id-1', { title: 'New' }, undefined), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.updateTask('id-1', { title: 'New' }, ''), /Mandatory userId is missing/i);
    assert.strictEqual(queryIssued, false, 'No database query must be issued when userId is missing');
  });

  test('11. Missing or invalid userId throws immediately for deleteTask without querying database', async () => {
    let queryIssued = false;
    const spyClient = {
      from: () => {
        queryIssued = true;
        return { delete: () => ({ eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [] }) }) }) }) };
      }
    };
    const adapter = new SupabaseStorageAdapter(spyClient, 'todos');

    await assert.rejects(() => adapter.deleteTask('id-1'), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.deleteTask('id-1', null), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.deleteTask('id-1', undefined), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.deleteTask('id-1', ''), /Mandatory userId is missing/i);
    assert.strictEqual(queryIssued, false, 'No database query must be issued when userId is missing');
  });

  test('12. Missing or invalid userId throws immediately for clearCompleted without querying database', async () => {
    let queryIssued = false;
    const spyClient = {
      from: () => {
        queryIssued = true;
        return { delete: () => ({ eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [] }) }) }) }) };
      }
    };
    const adapter = new SupabaseStorageAdapter(spyClient, 'todos');

    await assert.rejects(() => adapter.clearCompleted(), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.clearCompleted(null), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.clearCompleted(undefined), /Mandatory userId is missing/i);
    await assert.rejects(() => adapter.clearCompleted(''), /Mandatory userId is missing/i);
    assert.strictEqual(queryIssued, false, 'No database query must be issued when userId is missing');
  });

  test('13. In development mode with Supabase configured, real JWTs receive a request-scoped client forwarding the Bearer token', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_URL = 'https://liucmamlownxfshnaxtc.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'public-anon-key-123';
    resetStorage();

    // 1. initializeStorage creates devClient (activeAdapter)
    const initAdapter = await initializeStorage();
    assert.ok(initAdapter instanceof SupabaseStorageAdapter);

    // 2. Authenticated request with real JWT must receive a request-scoped client with Authorization header
    const scopedUserA = getScopedStorage({ userToken: 'real-user-A-jwt' });
    assert.ok(scopedUserA instanceof SupabaseStorageAdapter);
    assert.notStrictEqual(scopedUserA.client, initAdapter.client, 'Scoped client must be distinct from unauthenticated dev client');

    const authHeader = scopedUserA.client.headers.Authorization || scopedUserA.client.rest?.headers?.get('Authorization');
    assert.strictEqual(authHeader, 'Bearer real-user-A-jwt', 'User A Bearer JWT must be forwarded to Supabase');

    // 3. Unauthenticated request in dev falls back to default adapter
    const unscopedStorage = getScopedStorage(null);
    assert.strictEqual(unscopedStorage.client, initAdapter.client);

    // 4. Test injection with setStorage is honored
    const mockInjected = { isTestInjected: true };
    setStorage(mockInjected, 'supabase');
    const fromInjected = getScopedStorage({ userToken: 'any-token' });
    assert.strictEqual(fromInjected, mockInjected);
  });
});
