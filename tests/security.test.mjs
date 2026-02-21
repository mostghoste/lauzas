/**
 * Security test suite for laužas Supabase backend.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node tests/security.test.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ── Load .env ──────────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(resolve(__dir, '../.env'), 'utf8')
    .split('\n').filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()] })
)

const URL      = env.VITE_SUPABASE_URL
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY
const SVC_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !ANON_KEY) { console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env'); process.exit(1) }
if (!SVC_KEY)          { console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var'); process.exit(1) }

// ── Clients ────────────────────────────────────────────────────────────────
const admin = createClient(URL, SVC_KEY, { auth: { persistSession: false } })

// Two persistent anonymous clients — created once, reused across all tests
const clientA = createClient(URL, ANON_KEY, { auth: { persistSession: false } })
const clientB = createClient(URL, ANON_KEY, { auth: { persistSession: false } })
let uidA, uidB

// ── Helpers ────────────────────────────────────────────────────────────────
async function cleanRooms() {
  await admin.from('rooms').delete().or(`user1_id.eq.${uidA},user2_id.eq.${uidA},user1_id.eq.${uidB},user2_id.eq.${uidB}`)
}

async function matchAB() {
  await cleanRooms()
  await clientA.rpc('find_or_create_room')
  await clientB.rpc('find_or_create_room')
  const { data } = await admin.from('rooms').select('*')
    .or(`user1_id.eq.${uidA},user2_id.eq.${uidA}`)
    .eq('status', 'active').limit(1)
  return data?.[0] ?? null
}

async function roomOfA() {
  const { data } = await admin.from('rooms').select('*').eq('user1_id', uidA).limit(1)
  return data?.[0] ?? null
}

// ── Test runner ────────────────────────────────────────────────────────────
let passed = 0, failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
    passed++
  } catch (e) {
    if (e.message === 'SKIP') { console.log(`  \x1b[33m~\x1b[0m ${name} (skipped)`); return }
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
    console.log(`      \x1b[33m${e.message}\x1b[0m`)
    failed++
  }
}

function section(name) { console.log(`\n\x1b[1m${name}\x1b[0m`) }
function assert(cond, msg) { if (!cond) throw new Error(msg ?? 'Assertion failed') }
function assertDenied({ error, data }, msg) {
  const blocked = !!error || data === null || (Array.isArray(data) && data.length === 0)
  if (!blocked) throw new Error(msg ?? `Expected denial but got: ${JSON.stringify(data)}`)
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('\x1b[1mlaužas — Security Test Suite\x1b[0m')
  console.log(`Target: ${URL}`)

  // Sign in both users once
  console.log('\nSigning in test users...')
  const { data: dA, error: eA } = await clientA.auth.signInAnonymously()
  const { data: dB, error: eB } = await clientB.auth.signInAnonymously()
  if (eA || eB) { console.error('Failed to sign in:', eA || eB); process.exit(1) }
  uidA = dA.user.id
  uidB = dB.user.id
  console.log(`  User A: ${uidA}`)
  console.log(`  User B: ${uidB}`)

  // ── 1. Rooms SELECT ──────────────────────────────────────────────────
  section('1. Rooms — SELECT (RLS)')

  await test('user can select their own room', async () => {
    await cleanRooms()
    await clientA.rpc('find_or_create_room')
    const { data, error } = await clientA.from('rooms').select('*').eq('user1_id', uidA)
    assert(!error, error?.message)
    assert(data.length === 1, 'Expected to find own room')
  })

  await test('user cannot select a room they are not part of', async () => {
    await cleanRooms()
    await clientA.rpc('find_or_create_room')
    const room = await roomOfA()
    const { data } = await clientB.from('rooms').select('*').eq('id', room.id)
    assertDenied({ data }, "B should not see A's room")
  })

  // ── 2. Rooms INSERT ──────────────────────────────────────────────────
  section('2. Rooms — INSERT (RLS)')

  await test('user cannot insert a room with user1_id spoofed to another user', async () => {
    await cleanRooms()
    const { error } = await clientA.from('rooms').insert({ user1_id: uidB })
    assert(!!error, 'Expected spoofed insert to be denied')
  })

  await test('user cannot insert a room with user2_id already set', async () => {
    await cleanRooms()
    const { error } = await clientA.from('rooms').insert({ user1_id: uidA, user2_id: uidB })
    assert(!!error, 'Expected insert with user2_id to be denied')
  })

  // ── 3. Rooms UPDATE ──────────────────────────────────────────────────
  section('3. Rooms — UPDATE (RLS)')

  await test('user cannot UPDATE a room they are not part of', async () => {
    await cleanRooms()
    await clientA.rpc('find_or_create_room')
    const room = await roomOfA()
    const { data } = await clientB.from('rooms').update({ status: 'ended' }).eq('id', room.id).select()
    assertDenied({ data }, "B should not be able to update A's room")
  })

  await test('user cannot directly set fire_expires_at to bypass add_wood cap', async () => {
    const room = await matchAB()
    if (!room) throw new Error('SKIP')
    const farFuture = new Date(Date.now() + 999 * 60 * 1000).toISOString()
    await clientA.from('rooms').update({ fire_expires_at: farFuture }).eq('id', room.id)
    const { data: after } = await admin.from('rooms').select('fire_expires_at').eq('id', room.id).single()
    const actual = new Date(after.fire_expires_at)
    const tenMinsFromNow = new Date(Date.now() + 10 * 60 * 1000 + 5000)
    assert(actual < tenMinsFromNow, `fire_expires_at was extended to ${actual} — VULNERABILITY: rooms_update policy too permissive`)
  })

  await test('user cannot directly set status=ended to kick their partner', async () => {
    const room = await matchAB()
    if (!room) throw new Error('SKIP')
    await clientA.from('rooms').update({ status: 'ended' }).eq('id', room.id)
    const { data: after } = await admin.from('rooms').select('status').eq('id', room.id).single()
    assert(after.status !== 'ended', 'User directly set status=ended — VULNERABILITY: rooms_update policy too permissive')
  })

  await test('user cannot set user2_id to hijack both seats', async () => {
    await cleanRooms()
    await clientA.rpc('find_or_create_room')
    const room = await roomOfA()
    await clientA.from('rooms').update({ user2_id: uidA }).eq('id', room.id)
    const { data: after } = await admin.from('rooms').select('user2_id').eq('id', room.id).single()
    assert(after.user2_id !== uidA, 'User set user2_id to themselves — VULNERABILITY')
  })

  // ── 4. Messages SELECT ───────────────────────────────────────────────
  section('4. Messages — SELECT (RLS)')

  await test('user can select messages in their own room', async () => {
    const room = await matchAB()
    if (!room) throw new Error('SKIP')
    await admin.from('messages').insert({ room_id: room.id, user_id: uidA, content: 'hello', type: 'user' })
    const { data, error } = await clientA.from('messages').select('*').eq('room_id', room.id)
    assert(!error, error?.message)
    assert(data.length >= 1, 'Expected to see messages in own room')
  })

  await test('user cannot select messages in a room they are not part of', async () => {
    await cleanRooms()
    await clientA.rpc('find_or_create_room')
    const room = await roomOfA()
    await admin.from('messages').insert({ room_id: room.id, user_id: uidA, content: 'secret', type: 'user' })
    const { data } = await clientB.from('messages').select('*').eq('room_id', room.id)
    assertDenied({ data }, "B should not read A's messages")
  })

  // ── 5. Messages INSERT ───────────────────────────────────────────────
  section('5. Messages — INSERT (RLS)')

  await test('user cannot insert a message to a room they are not part of', async () => {
    await cleanRooms()
    await clientA.rpc('find_or_create_room')
    const room = await roomOfA()
    const { error } = await clientB.from('messages').insert({ room_id: room.id, user_id: uidB, content: 'intruder', type: 'user' })
    assert(!!error, 'Expected insert to be denied for non-participant')
  })

  await test('user cannot insert a message with a spoofed user_id', async () => {
    const room = await matchAB()
    if (!room) throw new Error('SKIP')
    const { error } = await clientB.from('messages').insert({ room_id: room.id, user_id: uidA, content: 'spoofed', type: 'user' })
    assert(!!error, 'Expected spoofed user_id to be denied')
  })

  await test('user cannot directly insert a system message (type=system)', async () => {
    const room = await matchAB()
    if (!room) throw new Error('SKIP')
    const { error } = await clientA.from('messages').insert({ room_id: room.id, user_id: uidA, content: 'fire_out', type: 'system' })
    assert(!!error, 'Expected direct system message insert to be denied')
  })

  await test('user cannot insert a message to a room with expired fire', async () => {
    const room = await matchAB()
    if (!room) throw new Error('SKIP')
    await admin.from('rooms').update({ fire_expires_at: new Date(Date.now() - 5000).toISOString() }).eq('id', room.id)
    const { error } = await clientA.from('messages').insert({ room_id: room.id, user_id: uidA, content: 'too late', type: 'user' })
    assert(!!error, 'Expected insert to be denied with expired fire')
  })

  await test('user cannot insert a message to an ended room', async () => {
    const room = await matchAB()
    if (!room) throw new Error('SKIP')
    await admin.from('rooms').update({ status: 'ended' }).eq('id', room.id)
    const { error } = await clientA.from('messages').insert({ room_id: room.id, user_id: uidA, content: 'ghost', type: 'user' })
    assert(!!error, 'Expected insert to be denied in ended room')
  })

  await test('user cannot insert an empty message', async () => {
    const room = await matchAB()
    if (!room) throw new Error('SKIP')
    const { error } = await clientA.from('messages').insert({ room_id: room.id, user_id: uidA, content: '', type: 'user' })
    assert(!!error, 'Expected empty message to be rejected by DB constraint')
  })

  await test('user cannot insert a message over 500 characters', async () => {
    const room = await matchAB()
    if (!room) throw new Error('SKIP')
    const { error } = await clientA.from('messages').insert({ room_id: room.id, user_id: uidA, content: 'a'.repeat(501), type: 'user' })
    assert(!!error, 'Expected >500 char message to be rejected by DB constraint')
  })

  // ── 6. RPCs — Unauthenticated access ─────────────────────────────────
  section('6. RPCs — Unauthenticated access')

  const unauthed = createClient(URL, ANON_KEY, { auth: { persistSession: false } })

  await test('unauthenticated user cannot call find_or_create_room', async () => {
    const { error } = await unauthed.rpc('find_or_create_room')
    assert(!!error, 'Expected unauthenticated RPC to fail')
  })

  await test('unauthenticated user cannot call add_wood', async () => {
    const { error } = await unauthed.rpc('add_wood', { p_room_id: '00000000-0000-0000-0000-000000000000' })
    assert(!!error, 'Expected unauthenticated add_wood to fail')
  })

  await test('unauthenticated user cannot call leave_room', async () => {
    const { error } = await unauthed.rpc('leave_room', { p_room_id: '00000000-0000-0000-0000-000000000000' })
    assert(!!error, 'Expected unauthenticated leave_room to fail')
  })

  await test('unauthenticated user cannot call insert_system_message', async () => {
    const { error } = await unauthed.rpc('insert_system_message', { p_room_id: '00000000-0000-0000-0000-000000000000', p_content: 'fire_out' })
    assert(!!error, 'Expected unauthenticated insert_system_message to fail')
  })

  await test('unauthenticated user cannot call try_rematch', async () => {
    const { error } = await unauthed.rpc('try_rematch', { p_current_room_id: '00000000-0000-0000-0000-000000000000' })
    assert(!!error, 'Expected unauthenticated try_rematch to fail')
  })

  // ── 7. RPCs — Participant enforcement ────────────────────────────────
  section('7. RPCs — Participant enforcement')

  await test('find_or_create_room returns the same room on repeated calls', async () => {
    await cleanRooms()
    const { data: id1 } = await clientA.rpc('find_or_create_room')
    const { data: id2 } = await clientA.rpc('find_or_create_room')
    assert(id1 === id2, `Got two different rooms: ${id1} vs ${id2}`)
  })

  await test('user cannot add_wood to a room they are not part of', async () => {
    await cleanRooms()
    await clientA.rpc('find_or_create_room')
    const room = await roomOfA()
    const before = room.fire_expires_at
    await clientB.rpc('add_wood', { p_room_id: room.id })
    const { data: after } = await admin.from('rooms').select('fire_expires_at').eq('id', room.id).single()
    assert(before === after.fire_expires_at, 'add_wood should have no effect for non-participant')
  })

  await test('user cannot leave_room a room they are not part of', async () => {
    await cleanRooms()
    await clientA.rpc('find_or_create_room')
    const room = await roomOfA()
    await clientB.rpc('leave_room', { p_room_id: room.id })
    const { data } = await admin.from('rooms').select('status').eq('id', room.id).single()
    assert(data.status !== 'ended', "B ended A's room — should not be possible")
  })

  await test('user cannot insert_system_message to a room they are not part of', async () => {
    await cleanRooms()
    await clientA.rpc('find_or_create_room')
    const room = await roomOfA()
    const { error } = await clientB.rpc('insert_system_message', { p_room_id: room.id, p_content: 'leave' })
    assert(!!error, 'Expected RPC to throw for non-participant')
  })

  await test('try_rematch returns null when caller does not own the waiting room', async () => {
    await cleanRooms()
    await clientA.rpc('find_or_create_room')
    const room = await roomOfA()
    // B tries to try_rematch using A's room id (B is not user1 of that room)
    const { data } = await clientB.rpc('try_rematch', { p_current_room_id: room.id })
    assert(data === null, 'try_rematch should return null for non-owner')
  })

  // ── Cleanup & summary ────────────────────────────────────────────────
  await cleanRooms()
  await admin.auth.admin.deleteUser(uidA)
  await admin.auth.admin.deleteUser(uidB)

  const total = passed + failed
  console.log(`\n${'─'.repeat(40)}`)
  console.log(`Results: ${passed}/${total} passed`)
  if (failed > 0) {
    console.log(`\x1b[31m${failed} test(s) failed\x1b[0m`)
    process.exit(1)
  } else {
    console.log('\x1b[32mAll tests passed\x1b[0m')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
