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
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'waiting'
                       CHECK (status IN ('waiting', 'active', 'ended')),
  room_type          text NOT NULL DEFAULT 'normal'
                       CHECK (room_type IN ('normal', 'stalked', 'triple', 'eternal')),
  fire_expires_at    timestamptz,
  waiting_expires_at timestamptz,
  fire_started_at    timestamptz,
  ended_at           timestamptz,
  last_heartbeat_at  timestamptz DEFAULT now(),
  user1_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user2_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user3_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user4_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user5_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  observer_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  extra_activated    boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content    text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  type       text NOT NULL DEFAULT 'user' CHECK (type IN ('user', 'system')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ugneles (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  count      integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────
-- Indexes
-- ──────────────────────────────

CREATE INDEX IF NOT EXISTS idx_rooms_waiting
  ON rooms(status) WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS idx_messages_room
  ON messages(room_id, created_at);

-- Prevents both users inserting a duplicate fire_out event for the same room
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_fire_out_per_room
  ON messages(room_id) WHERE content = 'fire_out';

-- ──────────────────────────────
-- Row-Level Security
-- ──────────────────────────────

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ugneles ENABLE ROW LEVEL SECURITY;

-- rooms: SELECT (all room participants)
DROP POLICY IF EXISTS rooms_select ON rooms;
CREATE POLICY rooms_select ON rooms
  FOR SELECT USING (
    auth.uid() IN (user1_id, user2_id, user3_id, user4_id, user5_id, observer_id)
  );

-- rooms: INSERT (user creating as user1, no partner yet)
DROP POLICY IF EXISTS rooms_insert ON rooms;
CREATE POLICY rooms_insert ON rooms
  FOR INSERT WITH CHECK (
    auth.uid() = user1_id AND user2_id IS NULL
  );

-- rooms: UPDATE — intentionally no client-side UPDATE policy.
-- All room mutations go through SECURITY DEFINER RPCs which bypass RLS.
DROP POLICY IF EXISTS rooms_update ON rooms;

-- messages: SELECT (must be in the room in any role)
DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM rooms r
      WHERE r.id = messages.room_id
        AND auth.uid() IN (r.user1_id, r.user2_id, r.user3_id, r.user4_id, r.user5_id, r.observer_id)
    )
  );

-- messages: INSERT (chatters only — observer cannot send; eternal has no timer check)
DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_insert ON messages
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND type = 'user'
    AND EXISTS (
      SELECT 1 FROM rooms r
      WHERE r.id = messages.room_id
        AND auth.uid() IN (r.user1_id, r.user2_id, r.user3_id, r.user4_id, r.user5_id)
        AND r.status = 'active'
        AND (r.room_type = 'eternal' OR r.fire_expires_at > now())
    )
  );

-- ugneles: SELECT (owner only)
DROP POLICY IF EXISTS ugneles_select ON ugneles;
CREATE POLICY ugneles_select ON ugneles
  FOR SELECT USING (auth.uid() = user_id);

-- ──────────────────────────────
-- Functions
-- ──────────────────────────────

-- find_or_create_room(): atomically joins/creates a room.
-- Priority: own existing room → eternal slot → triple user3 → stalked observer →
--           activate waiting room → create new waiting room (random type)
CREATE OR REPLACE FUNCTION find_or_create_room()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_room_id uuid;
  v_uid     uuid := auth.uid();
  v_type    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Return existing open room (any role)
  SELECT id INTO v_room_id
  FROM rooms
  WHERE v_uid IN (user1_id, user2_id, user3_id, user4_id, user5_id, observer_id)
    AND (
      (room_type = 'eternal' AND status = 'active')
      OR (status = 'active' AND fire_expires_at > now())
      OR (status = 'waiting' AND waiting_expires_at > now())
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_room_id IS NOT NULL THEN
    RETURN v_room_id;
  END IF;

  -- 2. Join an active eternal room with an open slot
  UPDATE rooms
  SET user2_id = CASE WHEN user2_id IS NULL THEN v_uid ELSE user2_id END,
      user3_id = CASE WHEN user2_id IS NOT NULL AND user3_id IS NULL THEN v_uid ELSE user3_id END,
      user4_id = CASE WHEN user2_id IS NOT NULL AND user3_id IS NOT NULL AND user4_id IS NULL THEN v_uid ELSE user4_id END,
      user5_id = CASE WHEN user2_id IS NOT NULL AND user3_id IS NOT NULL AND user4_id IS NOT NULL AND user5_id IS NULL THEN v_uid ELSE user5_id END
  WHERE id = (
    SELECT id FROM rooms
    WHERE room_type = 'eternal'
      AND status = 'active'
      AND (user2_id IS NULL OR user3_id IS NULL OR user4_id IS NULL OR user5_id IS NULL)
      AND user1_id != v_uid
      AND (user2_id IS NULL OR user2_id != v_uid)
      AND (user3_id IS NULL OR user3_id != v_uid)
      AND (user4_id IS NULL OR user4_id != v_uid)
      AND (user5_id IS NULL OR user5_id != v_uid)
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id INTO v_room_id;

  IF v_room_id IS NOT NULL THEN
    RETURN v_room_id;
  END IF;

  -- 3. Join an active triple room as user3 (only if slot never used before)
  UPDATE rooms
  SET user3_id = v_uid, extra_activated = true
  WHERE id = (
    SELECT id FROM rooms
    WHERE room_type = 'triple'
      AND status = 'active'
      AND user3_id IS NULL
      AND extra_activated = false
      AND fire_expires_at > now()
      AND user1_id != v_uid
      AND (user2_id IS NULL OR user2_id != v_uid)
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id INTO v_room_id;

  IF v_room_id IS NOT NULL THEN
    INSERT INTO messages (room_id, user_id, content, type)
    VALUES (v_room_id, v_uid, 'room_triple', 'system'),
           (v_room_id, v_uid, 'room_triple_sub', 'system'),
           (v_room_id, v_uid, 'room_triple_guest', 'system'),
           (v_room_id, v_uid, 'room_triple_guest_sub', 'system');
    RETURN v_room_id;
  END IF;

  -- 4. Join an active stalked room as observer (only if slot never used before)
  UPDATE rooms
  SET observer_id = v_uid, extra_activated = true
  WHERE id = (
    SELECT id FROM rooms
    WHERE room_type = 'stalked'
      AND status = 'active'
      AND observer_id IS NULL
      AND extra_activated = false
      AND fire_expires_at > now()
      AND user1_id != v_uid
      AND (user2_id IS NULL OR user2_id != v_uid)
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id INTO v_room_id;

  IF v_room_id IS NOT NULL THEN
    RETURN v_room_id;
  END IF;

  -- 5. Join a waiting room as user2 (activates it)
  UPDATE rooms
  SET user2_id        = v_uid,
      status          = 'active',
      fire_expires_at = CASE
        WHEN room_type = 'eternal' THEN NULL
        ELSE now() + interval '30 seconds'
      END,
      fire_started_at = now()
  WHERE id = (
    SELECT id FROM rooms
    WHERE status             = 'waiting'
      AND user1_id          != v_uid
      AND user2_id          IS NULL
      AND waiting_expires_at > now()
      AND (last_heartbeat_at IS NULL OR last_heartbeat_at > now() - interval '90 seconds')
      AND user1_id NOT IN (
        SELECT CASE WHEN user1_id = v_uid THEN user2_id ELSE user1_id END
        FROM rooms
        WHERE COALESCE(fire_expires_at, created_at) > now() - interval '1 minute'
          AND (user1_id = v_uid OR user2_id = v_uid)
          AND user2_id IS NOT NULL
      )
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, room_type INTO v_room_id, v_type;

  IF v_room_id IS NOT NULL THEN
    IF v_type = 'stalked' THEN
      INSERT INTO messages (room_id, user_id, content, type)
      VALUES (v_room_id, v_uid, 'room_stalked', 'system'),
             (v_room_id, v_uid, 'room_stalked_sub', 'system');
    ELSIF v_type = 'eternal' THEN
      INSERT INTO messages (room_id, user_id, content, type)
      VALUES (v_room_id, v_uid, 'room_eternal', 'system'),
             (v_room_id, v_uid, 'room_eternal_sub', 'system');
    END IF;
    RETURN v_room_id;
  END IF;

  -- 6. Create a new waiting room
  v_type := CASE WHEN random() < 0.10 THEN 'triple' ELSE 'normal' END;

  INSERT INTO rooms (user1_id, status, waiting_expires_at, room_type, last_heartbeat_at)
  VALUES (v_uid, 'waiting', now() + interval '5 minutes', v_type, now())
  RETURNING id INTO v_room_id;

  RETURN v_room_id;
END;
$func$;

-- try_rematch(): called by waiting clients every 3s.
-- Updates heartbeat and tries to join any available room (eternal/triple/stalked/waiting).
CREATE OR REPLACE FUNCTION try_rematch(p_current_room_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_uid      uuid := auth.uid();
  v_new_room uuid;
  v_type     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM rooms
    WHERE id = p_current_room_id
      AND user1_id = v_uid
      AND status = 'waiting'
      AND waiting_expires_at > now()
  ) THEN
    RETURN NULL;
  END IF;

  -- Update heartbeat
  UPDATE rooms SET last_heartbeat_at = now() WHERE id = p_current_room_id;

  -- Try eternal room
  UPDATE rooms
  SET user2_id = CASE WHEN user2_id IS NULL THEN v_uid ELSE user2_id END,
      user3_id = CASE WHEN user2_id IS NOT NULL AND user3_id IS NULL THEN v_uid ELSE user3_id END,
      user4_id = CASE WHEN user2_id IS NOT NULL AND user3_id IS NOT NULL AND user4_id IS NULL THEN v_uid ELSE user4_id END,
      user5_id = CASE WHEN user2_id IS NOT NULL AND user3_id IS NOT NULL AND user4_id IS NOT NULL AND user5_id IS NULL THEN v_uid ELSE user5_id END
  WHERE id = (
    SELECT id FROM rooms
    WHERE room_type = 'eternal'
      AND status = 'active'
      AND (user2_id IS NULL OR user3_id IS NULL OR user4_id IS NULL OR user5_id IS NULL)
      AND user1_id != v_uid
      AND (user2_id IS NULL OR user2_id != v_uid)
      AND (user3_id IS NULL OR user3_id != v_uid)
      AND (user4_id IS NULL OR user4_id != v_uid)
      AND (user5_id IS NULL OR user5_id != v_uid)
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id INTO v_new_room;

  IF v_new_room IS NOT NULL THEN
    UPDATE rooms SET status = 'ended' WHERE id = p_current_room_id;
    RETURN v_new_room;
  END IF;

  -- Try triple room (join as user3, only if never activated)
  UPDATE rooms
  SET user3_id = v_uid, extra_activated = true
  WHERE id = (
    SELECT id FROM rooms
    WHERE room_type = 'triple'
      AND status = 'active'
      AND user3_id IS NULL
      AND extra_activated = false
      AND fire_expires_at > now()
      AND user1_id != v_uid
      AND (user2_id IS NULL OR user2_id != v_uid)
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id INTO v_new_room;

  IF v_new_room IS NOT NULL THEN
    INSERT INTO messages (room_id, user_id, content, type)
    VALUES (v_new_room, v_uid, 'room_triple', 'system'),
           (v_new_room, v_uid, 'room_triple_sub', 'system'),
           (v_new_room, v_uid, 'room_triple_guest', 'system'),
           (v_new_room, v_uid, 'room_triple_guest_sub', 'system');
    UPDATE rooms SET status = 'ended' WHERE id = p_current_room_id;
    RETURN v_new_room;
  END IF;

  -- Try stalked room (join as observer, only if never activated)
  UPDATE rooms
  SET observer_id = v_uid, extra_activated = true
  WHERE id = (
    SELECT id FROM rooms
    WHERE room_type = 'stalked'
      AND status = 'active'
      AND observer_id IS NULL
      AND extra_activated = false
      AND fire_expires_at > now()
      AND user1_id != v_uid
      AND (user2_id IS NULL OR user2_id != v_uid)
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id INTO v_new_room;

  IF v_new_room IS NOT NULL THEN
    UPDATE rooms SET status = 'ended' WHERE id = p_current_room_id;
    RETURN v_new_room;
  END IF;

  -- Try standard waiting room
  UPDATE rooms
  SET user2_id        = v_uid,
      status          = 'active',
      fire_expires_at = CASE
        WHEN room_type = 'eternal' THEN NULL
        ELSE now() + interval '30 seconds'
      END,
      fire_started_at = now()
  WHERE id = (
    SELECT id FROM rooms
    WHERE status             = 'waiting'
      AND user1_id          != v_uid
      AND user2_id          IS NULL
      AND waiting_expires_at > now()
      AND id                != p_current_room_id
      AND (last_heartbeat_at IS NULL OR last_heartbeat_at > now() - interval '90 seconds')
      AND user1_id NOT IN (
        SELECT CASE WHEN user1_id = v_uid THEN user2_id ELSE user1_id END
        FROM rooms
        WHERE COALESCE(fire_expires_at, created_at) > now() - interval '1 minute'
          AND (user1_id = v_uid OR user2_id = v_uid)
          AND user2_id IS NOT NULL
      )
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, room_type INTO v_new_room, v_type;

  IF v_new_room IS NOT NULL THEN
    IF v_type = 'stalked' THEN
      INSERT INTO messages (room_id, user_id, content, type)
      VALUES (v_new_room, v_uid, 'room_stalked', 'system'),
             (v_new_room, v_uid, 'room_stalked_sub', 'system');
    ELSIF v_type = 'eternal' THEN
      INSERT INTO messages (room_id, user_id, content, type)
      VALUES (v_new_room, v_uid, 'room_eternal', 'system'),
             (v_new_room, v_uid, 'room_eternal_sub', 'system');
    END IF;
    UPDATE rooms SET status = 'ended' WHERE id = p_current_room_id;
    RETURN v_new_room;
  END IF;

  RETURN NULL;
END;
$func$;

-- add_wood(): extend fire by 1 minute (capped at 10 min), or award 1 Ugnelė in eternal rooms
CREATE OR REPLACE FUNCTION add_wood(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_uid       uuid := auth.uid();
  v_room_type text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT room_type INTO v_room_type
  FROM rooms
  WHERE id = p_room_id
    AND v_uid IN (user1_id, user2_id, user3_id, user4_id, user5_id)
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_room_type = 'eternal' THEN
    INSERT INTO ugneles (user_id, count, updated_at)
    VALUES (v_uid, 1, now())
    ON CONFLICT (user_id) DO UPDATE
      SET count = ugneles.count + 1, updated_at = now();
  ELSE
    UPDATE rooms
    SET fire_expires_at = LEAST(
      GREATEST(fire_expires_at, now()) + interval '1 minute',
      now() + interval '10 minutes'
    )
    WHERE id = p_room_id
      AND status = 'active';
  END IF;
END;
$func$;

-- leave_room(): observer clears slot; eternal non-creator removes slot; others end the room
CREATE OR REPLACE FUNCTION leave_room(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_uid  uuid := auth.uid();
  v_room rooms%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_room
  FROM rooms
  WHERE id = p_room_id
    AND v_uid IN (user1_id, user2_id, user3_id, user4_id, user5_id, observer_id)
    AND status IN ('waiting', 'active');

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Observer: clear observer slot only
  IF v_room.observer_id = v_uid THEN
    UPDATE rooms SET observer_id = NULL WHERE id = p_room_id;
    RETURN;
  END IF;

  -- Triple user3: remove slot, room continues for user1+user2
  IF v_room.room_type = 'triple' AND v_room.user3_id = v_uid THEN
    UPDATE rooms SET user3_id = NULL WHERE id = p_room_id;
    RETURN;
  END IF;

  -- Eternal active: remove user slot (or end if creator leaves)
  IF v_room.room_type = 'eternal' AND v_room.status = 'active' THEN
    IF v_room.user1_id = v_uid THEN
      UPDATE rooms SET status = 'ended', ended_at = now() WHERE id = p_room_id;
    ELSE
      UPDATE rooms
      SET user2_id = CASE WHEN user2_id = v_uid THEN NULL ELSE user2_id END,
          user3_id = CASE WHEN user3_id = v_uid THEN NULL ELSE user3_id END,
          user4_id = CASE WHEN user4_id = v_uid THEN NULL ELSE user4_id END,
          user5_id = CASE WHEN user5_id = v_uid THEN NULL ELSE user5_id END
      WHERE id = p_room_id;
    END IF;
    RETURN;
  END IF;

  -- Default: end the room
  UPDATE rooms
  SET status = 'ended', ended_at = now()
  WHERE id = p_room_id
    AND status IN ('waiting', 'active');
END;
$func$;

-- get_online_count(): counts distinct users in open rooms (all roles)
CREATE OR REPLACE FUNCTION get_online_count()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT COUNT(DISTINCT uid)::integer FROM (
    SELECT user1_id   AS uid FROM rooms WHERE status IN ('waiting', 'active')
    UNION ALL
    SELECT user2_id   FROM rooms WHERE status IN ('waiting', 'active') AND user2_id   IS NOT NULL
    UNION ALL
    SELECT user3_id   FROM rooms WHERE status IN ('waiting', 'active') AND user3_id   IS NOT NULL
    UNION ALL
    SELECT user4_id   FROM rooms WHERE status IN ('waiting', 'active') AND user4_id   IS NOT NULL
    UNION ALL
    SELECT user5_id   FROM rooms WHERE status IN ('waiting', 'active') AND user5_id   IS NOT NULL
    UNION ALL
    SELECT observer_id FROM rooms WHERE status IN ('waiting', 'active') AND observer_id IS NOT NULL
  ) u;
$func$;

-- insert_system_message(): inserts a system event (bypasses RLS fire check)
CREATE OR REPLACE FUNCTION insert_system_message(p_room_id uuid, p_content text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM rooms
    WHERE id = p_room_id
      AND v_uid IN (user1_id, user2_id, user3_id, user4_id, user5_id, observer_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO messages (room_id, user_id, content, type)
  VALUES (p_room_id, v_uid, p_content, 'system')
  ON CONFLICT (room_id) WHERE content = 'fire_out' DO NOTHING;
END;
$func$;

-- get_my_ugneles(): returns caller's Ugnelė count
CREATE OR REPLACE FUNCTION get_my_ugneles()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT COALESCE(
    (SELECT count FROM ugneles WHERE user_id = auth.uid()),
    0
  )::integer;
$func$;

-- get_top_fires(): leaderboard — excludes eternal rooms
CREATE OR REPLACE FUNCTION get_top_fires(p_period text DEFAULT 'today', p_only_active boolean DEFAULT false)
RETURNS TABLE (duration_seconds numeric, is_active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT
    EXTRACT(EPOCH FROM (
      CASE
        WHEN status = 'active' THEN now() - fire_started_at
        ELSE LEAST(fire_expires_at, ended_at) - fire_started_at
      END
    ))::numeric AS duration_seconds,
    (status = 'active') AS is_active
  FROM rooms
  WHERE fire_started_at IS NOT NULL
    AND room_type != 'eternal'
    AND (p_only_active = false OR status = 'active')
    AND (
      p_period = 'alltime'
      OR fire_started_at > now() - interval '1 day'
    )
  ORDER BY duration_seconds DESC
  LIMIT 5;
$func$;

-- ──────────────────────────────
-- Scheduled cleanup (pg_cron)
-- ──────────────────────────────
-- Requires pg_cron extension: Supabase Dashboard > Database > Extensions > pg_cron

SELECT cron.schedule(
  'expire-active-rooms',
  '* * * * *',
  $$
    UPDATE rooms
    SET status = 'ended', ended_at = now()
    WHERE status = 'active'
      AND room_type != 'eternal'
      AND fire_expires_at < now();
  $$
);

SELECT cron.schedule(
  'expire-waiting-rooms',
  '* * * * *',
  $$
    UPDATE rooms
    SET status = 'ended'
    WHERE status = 'waiting'
      AND waiting_expires_at < now();
  $$
);

-- ──────────────────────────────
-- Realtime
-- ──────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
