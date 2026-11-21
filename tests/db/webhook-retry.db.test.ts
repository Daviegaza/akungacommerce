import { randomInt, randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { DB_URL, asUser, closeDb, createOrg, createUser, db } from './helpers'

/**
 * Reliable WhatsApp opt-out processing (20261121000080_webhook_retry.sql): consent and the
 * processed flag change in one transaction; failures are recorded and stay retryable.
 */
const run = describe.skipIf(!DB_URL)

const phone = () => `+2547${String(randomInt(10_000_000, 99_999_999))}`
const KE = { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' }

async function connectWhatsApp(org: string, pn: string) {
  await db().query(
    `insert into public.integration_connections (org_id, provider, kind, state, public_config)
     values ($1, 'whatsapp', 'whatsapp', 'configured_unverified', jsonb_build_object('phone_number_id', $2::text))`,
    [org, pn],
  )
}

async function setup() {
  const owner = await createUser('wa')
  const org = await createOrg(owner, 'KES', KE)
  const pn = `PN${randomUUID().slice(0, 12)}`
  await connectWhatsApp(org, pn)
  const tel = phone()
  const { rows } = await db().query<{ id: string }>(
    `insert into public.customers (org_id, name, phone_e164, marketing_consent) values ($1, 'Amina', $2, true) returning id`,
    [org, tel],
  )
  return { owner, org, pn, tel, customerId: rows[0].id }
}

async function storeEvent(eventId: string) {
  await db().query(`insert into public.webhook_events (provider, event_id, payload) values ('whatsapp', $1, '{}'::jsonb)`, [eventId])
}
async function apply(eventId: string, pn: string, tel: string) {
  const { rows } = await db().query<{ r: Record<string, unknown> }>(`select public.whatsapp_apply_opt_out($1, $2, $3) as r`, [eventId, pn, tel])
  return rows[0].r
}
async function failed(eventId: string, error: string, max = 8) {
  const { rows } = await db().query<{ r: Record<string, unknown> }>(`select public.webhook_event_failed('whatsapp', $1, $2, $3) as r`, [eventId, error, max])
  return rows[0].r
}
async function eventRow(eventId: string) {
  const { rows } = await db().query(
    `select processed_at, attempts, last_error, dead_at, org_id from public.webhook_events where provider = 'whatsapp' and event_id = $1`,
    [eventId],
  )
  return rows[0]
}
async function customer(id: string) {
  const { rows } = await db().query(`select marketing_consent, consent_source from public.customers where id = $1`, [id])
  return rows[0]
}

afterAll(async () => {
  await closeDb()
})

run('WhatsApp opt-out processing', () => {
  it('withdraws consent with source stop_reply and marks the event processed atomically', async () => {
    const s = await setup()
    const ev = `wamid.${randomUUID()}`
    await storeEvent(ev)
    expect(await apply(ev, s.pn, s.tel)).toMatchObject({ outcome: 'opted_out', customers: 1, org_id: s.org })
    expect(await customer(s.customerId)).toEqual({ marketing_consent: false, consent_source: 'stop_reply' })
    const row = await eventRow(ev)
    expect(row.processed_at).not.toBeNull()
    expect(row.org_id).toBe(s.org)
  })

  it('a duplicate delivery is a no-op', async () => {
    const s = await setup()
    const ev = `wamid.${randomUUID()}`
    await storeEvent(ev)
    await apply(ev, s.pn, s.tel)
    // Staff record a new opt-in later; a replayed STOP must not undo that.
    const c = await db().connect()
    try {
      await c.query('begin')
      await c.query("select set_config('akunga.consent_source', 'staff', true)")
      await c.query('update public.customers set marketing_consent = true where id = $1', [s.customerId])
      await c.query('commit')
    } finally {
      c.release()
    }
    expect(await apply(ev, s.pn, s.tel)).toEqual({ outcome: 'duplicate' })
    expect((await customer(s.customerId)).marketing_consent).toBe(true)
  })

  it('a failed consent update leaves the event unprocessed; the failure is recorded; a retry succeeds', async () => {
    const s = await setup()
    const ev = `wamid.${randomUUID()}`
    await storeEvent(ev)
    const fn = `fail_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    await db().query(
      `create function public.${fn}() returns trigger language plpgsql as $f$ begin
         if new.phone_e164 = '${s.tel}' then raise exception 'simulated outage' using errcode = '08006'; end if;
         return new; end $f$`,
    )
    await db().query(`create trigger ${fn} before update on public.customers for each row execute function public.${fn}()`)
    try {
      await expect(apply(ev, s.pn, s.tel)).rejects.toThrow(/simulated outage/)
      expect((await eventRow(ev)).processed_at).toBeNull()
      expect((await customer(s.customerId)).marketing_consent).toBe(true)

      expect(await failed(ev, 'simulated outage')).toEqual({ attempts: 1, dead: false })
      // Back-off: just attempted, so the scheduled retry does not pick it up immediately.
      const pending = await db().query(`select event_id from public.webhook_events_pending('whatsapp', 500)`)
      expect(pending.rows.map((r) => r.event_id)).not.toContain(ev)
      expect(await eventRow(ev)).toMatchObject({ attempts: 1, last_error: 'simulated outage', processed_at: null, dead_at: null })
    } finally {
      await db().query(`drop trigger ${fn} on public.customers`)
      await db().query(`drop function public.${fn}()`)
    }
    // Provider re-delivers (or the scheduled retry runs): now it succeeds.
    expect(await apply(ev, s.pn, s.tel)).toMatchObject({ outcome: 'opted_out' })
    expect(await customer(s.customerId)).toEqual({ marketing_consent: false, consent_source: 'stop_reply' })
    expect(await eventRow(ev)).toMatchObject({ attempts: 2, last_error: null })
  })

  it('a stored, never-attempted event is offered to the scheduled retry', async () => {
    const ev = `wamid.${randomUUID()}`
    await storeEvent(ev)
    const pending = await db().query(`select event_id from public.webhook_events_pending('whatsapp', 500)`)
    expect(pending.rows.map((r) => r.event_id)).toContain(ev)
  })

  it('parks an event after the maximum attempts and never marks it processed', async () => {
    const s = await setup()
    const ev = `wamid.${randomUUID()}`
    await storeEvent(ev)
    await failed(ev, 'x', 2)
    expect(await failed(ev, 'x', 2)).toEqual({ attempts: 2, dead: true })
    expect(await apply(ev, s.pn, s.tel)).toEqual({ outcome: 'dead' })
    expect((await eventRow(ev)).processed_at).toBeNull()
    expect((await customer(s.customerId)).marketing_consent).toBe(true)
  })

  it('an unknown business number is processed without touching any customer', async () => {
    const s = await setup()
    const ev = `wamid.${randomUUID()}`
    await storeEvent(ev)
    expect(await apply(ev, 'PN-not-ours', s.tel)).toMatchObject({ outcome: 'no_org', customers: 0 })
    expect((await customer(s.customerId)).marketing_consent).toBe(true)
  })

  it('only the service role can call the processing functions', async () => {
    const s = await setup()
    await expect(asUser(s.owner, `select public.whatsapp_apply_opt_out('x', 'y', '+254700000000')`)).rejects.toThrow(/permission denied/)
    await expect(asUser(null, `select public.webhook_event_failed('whatsapp', 'x', 'y')`)).rejects.toThrow(/permission denied/)
    await expect(asUser(s.owner, `select * from public.webhook_events_pending('whatsapp')`)).rejects.toThrow(/permission denied/)
  })

  it('one WhatsApp number cannot be connected to two organisations', async () => {
    const s = await setup()
    const other = await createOrg(await createUser('wa2'), 'KES', KE)
    await expect(connectWhatsApp(other, s.pn)).rejects.toThrow(/duplicate key/)
  })
})
