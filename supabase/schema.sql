-- ============================================================
-- laužas-chat — Supabase Schema
-- ============================================================
-- Setup steps (Supabase Dashboard):
--   1. Auth > Providers > Anonymous — enable it
--   2. Database > Replication — enable rooms and messages tables
--   3. Run this file in the SQL editor
-- ============================================================

-- ──────────────────────────────
-- Tables
-- ──────────────────────────────

CREATE TABLE IF NOT EXISTS rooms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting', 'active', 'ended')),
  fire_expires_at timestamptz,
  user1_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user2_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content    text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────
-- Indexes
-- ──────────────────────────────

CREATE INDEX IF NOT EXISTS idx_rooms_waiting
  ON rooms(status) WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS idx_messages_room
  ON messages(room_id, created_at);

-- ──────────────────────────────
-- Row-Level Security
-- ──────────────────────────────

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- rooms: SELECT
DROP POLICY IF EXISTS rooms_select ON rooms;
CREATE POLICY rooms_select ON rooms
  FOR SELECT USING (
    auth.uid() = user1_id OR auth.uid() = user2_id
  );

-- rooms: INSERT (user creating as user1, no partner yet)
DROP POLICY IF EXISTS rooms_insert ON rooms;
CREATE POLICY rooms_insert ON rooms
  FOR INSERT WITH CHECK (
    auth.uid() = user1_id AND user2_id IS NULL
  );

-- rooms: UPDATE (either participant)
DROP POLICY IF EXISTS rooms_update ON rooms;
CREATE POLICY rooms_update ON rooms
  FOR UPDATE USING (
    auth.uid() = user1_id OR auth.uid() = user2_id
  );

-- messages: SELECT (must be in the room)
DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM rooms r
      WHERE r.id = messages.room_id
        AND (r.user1_id = auth.uid() OR r.user2_id = auth.uid())
    )
  );

-- messages: INSERT (must own the message AND room must be active with live fire)
DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_insert ON messages
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM rooms r
      WHERE r.id = messages.room_id
        AND (r.user1_id = auth.uid() OR r.user2_id = auth.uid())
        AND r.status = 'active'
        AND r.fire_expires_at > now()
    )
  );

-- ──────────────────────────────
-- Functions
-- ──────────────────────────────

-- find_or_create_room(): atomically joins an existing waiting room or creates one
CREATE OR REPLACE FUNCTION find_or_create_room()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id uuid;
  v_uid     uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Check if caller already has an open room
  SELECT id INTO v_room_id
  FROM rooms
  WHERE (user1_id = v_uid OR user2_id = v_uid)
    AND status IN ('waiting', 'active')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_room_id IS NOT NULL THEN
    RETURN v_room_id;
  END IF;

  -- 2. Try to join a waiting room from another user; start the timer now
  UPDATE rooms
  SET user2_id        = v_uid,
      status          = 'active',
      fire_expires_at = now() + interval '3 minutes'
  WHERE id = (
    SELECT id FROM rooms
    WHERE status   = 'waiting'
      AND user1_id != v_uid
      AND user2_id IS NULL
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id INTO v_room_id;

  IF v_room_id IS NOT NULL THEN
    RETURN v_room_id;
  END IF;

  -- 3. No room found — create a new waiting room (timer starts when matched)
  INSERT INTO rooms (user1_id, status)
  VALUES (v_uid, 'waiting')
  RETURNING id INTO v_room_id;

  RETURN v_room_id;
END;
$$;

-- add_wood(): extend fire by 1 minute (capped at 10 minutes total)
CREATE OR REPLACE FUNCTION add_wood(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE rooms
  SET fire_expires_at = LEAST(
    GREATEST(fire_expires_at, now()) + interval '1 minute',
    now() + interval '10 minutes'
  )
  WHERE id = p_room_id
    AND (user1_id = v_uid OR user2_id = v_uid)
    AND status = 'active';
END;
$$;

-- leave_room(): mark room as ended
CREATE OR REPLACE FUNCTION leave_room(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE rooms
  SET status = 'ended'
  WHERE id = p_room_id
    AND (user1_id = v_uid OR user2_id = v_uid)
    AND status IN ('waiting', 'active');
END;
$$;

-- ──────────────────────────────
-- Realtime
-- ──────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
