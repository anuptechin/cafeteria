import pg from "pg";
import { env } from "./env.js";

// Return NUMERIC as JS number instead of string.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// Return BIGINT counts as number (counts here are well within Number range).
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params: any[] = []
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(
  text: string,
  params: any[] = []
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

// Run `fn` inside a transaction whose RLS actor context is set to (role, userId).
// Used for every access to the RLS-protected tables (users, audit_log) so the
// database itself enforces who can see/modify what. `set_config(..., true)` is
// transaction-local, so the context can never leak to another pooled request.
export async function withActor<T>(
  role: string,
  userId: number | null,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.actor_role', $1, true)", [role]);
    await client.query("SELECT set_config('app.actor_id', $1, true)", [
      userId == null ? "" : String(userId),
    ]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
