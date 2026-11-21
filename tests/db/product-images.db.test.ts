import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_URL, addMember, asUser, closeDb, createOrg, createProduct, createUser, db, type TestUser } from './helpers'

const run = describe.skipIf(!DB_URL)

/** Insert an object row as the user; RLS on storage.objects decides. */
const insertObject = (user: TestUser | null, name: string, bucket = 'product-images') =>
  asUser(user, `insert into storage.objects (bucket_id, name) values ($1, $2) returning name`, [bucket, name])

const objectKey = (org: string) => `${org}/${randomUUID()}.webp`

/**
 * Delete as the user the way the Storage API does: it sets
 * storage.allow_delete_query (otherwise a guard trigger blocks direct deletes),
 * and RLS still decides which rows are visible to delete.
 */
async function deleteObject(user: TestUser, name: string): Promise<number> {
  const client = await db().connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user.id, role: 'authenticated', email: user.email })])
    await client.query(`select set_config('storage.allow_delete_query', 'true', true)`)
    await client.query('set local role authenticated')
    const res = await client.query(`delete from storage.objects where bucket_id = 'product-images' and name = $1`, [name])
    await client.query('commit')
    return res.rowCount ?? 0
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}

run('product-images storage bucket', () => {
  let owner: TestUser
  let manager: TestUser
  let sales: TestUser
  let stranger: TestUser
  let org: string
  let otherOrg: string

  beforeAll(async () => {
    owner = await createUser('img-owner')
    manager = await createUser('img-manager')
    sales = await createUser('img-sales')
    stranger = await createUser('img-stranger')
    org = await createOrg(owner, 'KES', { country: 'KE', tz: 'Africa/Nairobi', locale: 'en-KE' })
    otherOrg = await createOrg(stranger)
    await addMember(owner, org, manager, 'manager')
    await addMember(owner, org, sales, 'sales')
  })

  it('is public with a 5 MB limit and image-only mime types; product-media stays private', async () => {
    const { rows } = await db().query(`select id, public, file_size_limit, allowed_mime_types from storage.buckets where id in ('product-images', 'product-media') order by id`)
    expect(rows).toEqual([
      { id: 'product-images', public: true, file_size_limit: '5242880', allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] },
      expect.objectContaining({ id: 'product-media', public: false }),
    ])
  })

  it('members with catalogue.write can upload into their own org folder', async () => {
    expect(await insertObject(owner, objectKey(org))).toHaveLength(1)
    expect(await insertObject(manager, objectKey(org))).toHaveLength(1)
  })

  it('members without catalogue.write, other orgs and anonymous users cannot upload', async () => {
    await expect(insertObject(sales, objectKey(org))).rejects.toThrow(/row-level security/)
    await expect(insertObject(stranger, objectKey(org))).rejects.toThrow(/row-level security/)
    await expect(insertObject(owner, objectKey(otherOrg))).rejects.toThrow(/row-level security/)
    await expect(insertObject(null, objectKey(org))).rejects.toThrow(/row-level security|permission denied/)
  })

  it('rejects keys outside an org folder without a cast error', async () => {
    await expect(insertObject(owner, `not-a-uuid/${randomUUID()}.webp`)).rejects.toThrow(/row-level security/)
    await expect(insertObject(owner, `${randomUUID()}.webp`)).rejects.toThrow(/row-level security/)
  })

  it('only catalogue writers of the org can list, update or delete its objects', async () => {
    const name = objectKey(org)
    await insertObject(owner, name)
    const sel = `select name from storage.objects where bucket_id = 'product-images' and name = $1`
    expect(await asUser(owner, sel, [name])).toHaveLength(1)
    expect(await asUser(stranger, sel, [name])).toHaveLength(0)
    expect(await asUser(sales, sel, [name])).toHaveLength(0)
    expect(await asUser(null, sel, [name]).catch(() => [])).toHaveLength(0)

    expect(await deleteObject(stranger, name)).toBe(0)
    expect(await deleteObject(sales, name)).toBe(0)
    // Moving an object into another org's folder is blocked by the update check.
    await expect(
      asUser(owner, `update storage.objects set name = $2 where bucket_id = 'product-images' and name = $1`, [name, objectKey(otherOrg)]),
    ).rejects.toThrow(/row-level security/)
    expect(await deleteObject(manager, name)).toBe(1)
  })

  it('existing private product-media policies are unchanged (members only)', async () => {
    expect(await insertObject(owner, objectKey(org), 'product-media')).toHaveLength(1)
    await expect(insertObject(stranger, objectKey(org), 'product-media')).rejects.toThrow(/row-level security/)
  })

  it('product images accept https links and the local public URL of the own org folder only', async () => {
    const { productId } = await createProduct(owner, org, 1000)
    const setImages = (user: TestUser, url: string) =>
      asUser(user, `select public.set_product_merchandising($1, $2, $3::jsonb, false, null)`, [org, productId, JSON.stringify([{ url, alt: 'Photo' }])])
    const local = (folder: string, host = '127.0.0.1:58321') => `http://${host}/storage/v1/object/public/product-images/${folder}/${randomUUID()}.webp`

    await setImages(owner, `https://project.supabase.co/storage/v1/object/public/product-images/${org}/a.webp`)
    await setImages(owner, local(org))
    await setImages(owner, local(org, 'localhost:54321'))
    await expect(setImages(owner, local(otherOrg))).rejects.toThrow(/https/)
    await expect(setImages(owner, `http://evil.test/storage/v1/object/public/product-images/${org}/a.webp`)).rejects.toThrow(/https/)
    await expect(setImages(owner, local(`${org}/../${otherOrg}`))).rejects.toThrow(/https/)
    await expect(setImages(owner, 'data:image/webp;base64,AAAA')).rejects.toThrow(/https/)
    await expect(setImages(sales, local(org))).rejects.toThrow(/permission/)
  })
})

afterAll(async () => {
  await closeDb()
})
