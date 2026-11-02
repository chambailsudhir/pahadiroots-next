// Best-effort "Verified purchase" flag for already-fetched review rows.
//
// db_migration_v23 adds reviews.is_verified_purchase. The storefront's existing SELECT lists must keep working BEFORE that
// migration is applied (an unknown column makes PostgREST answer 400 and the whole reviews query would fail), so the flag is
// read with a SEPARATE query by id. If that query errors for any reason (column missing, timeout) the rows are returned
// unchanged and simply show no badge. Never throws.

type Row = { id: string | number }
type Client = {
  from: (t: string) => {
    select: (c: string) => { in: (col: string, vals: Array<string | number>) => PromiseLike<{ data: unknown; error: unknown }> }
  }
}

export async function withVerifiedFlag<T extends Row>(client: Client, rows: T[]): Promise<Array<T & { is_verified_purchase?: boolean }>> {
  if (!rows.length) return rows
  try {
    const { data, error } = await client.from('reviews').select('id, is_verified_purchase').in('id', rows.map(r => r.id))
    if (error || !Array.isArray(data)) return rows
    const verified = new Set((data as Array<{ id: string | number; is_verified_purchase?: unknown }>)
      .filter(d => d.is_verified_purchase === true).map(d => String(d.id)))
    return rows.map(r => (verified.has(String(r.id)) ? { ...r, is_verified_purchase: true } : r))
  } catch {
    return rows
  }
}
