-- HealYou Wellness Platform — Database Schema
-- Run once against your Neon / PostgreSQL database

-- ── Organizations (employers / clients) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  contact_name  TEXT,
  contact_email TEXT,
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Coaches ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaches (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  bio         TEXT,
  avatar_url  TEXT,
  specialty   TEXT,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Participants (employees / clients) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS participants (
  id                  SERIAL PRIMARY KEY,
  org_id              INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  assigned_coach_id   INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
  email               TEXT UNIQUE NOT NULL,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  date_of_birth       DATE,
  gender              TEXT,     -- male | female | non_binary | prefer_not
  phone               TEXT,
  employee_id         TEXT,
  department          TEXT,
  active              BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── Screening Events ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS screening_events (
  id          SERIAL PRIMARY KEY,
  org_id      INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  event_date  DATE NOT NULL,
  location    TEXT,
  event_type  TEXT DEFAULT 'onsite',     -- onsite | virtual | self_reported
  status      TEXT DEFAULT 'scheduled',  -- scheduled | in_progress | completed | cancelled
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Biometric Results ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS biometric_results (
  id                      SERIAL PRIMARY KEY,
  participant_id          INTEGER REFERENCES participants(id) ON DELETE CASCADE,
  event_id                INTEGER REFERENCES screening_events(id) ON DELETE SET NULL,
  screened_by             INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
  screened_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Physical measurements
  height_in               NUMERIC(5,1),
  weight_lbs              NUMERIC(6,1),
  bmi                     NUMERIC(5,2),       -- auto-calculated
  waist_circumference_in  NUMERIC(5,1),
  body_fat_pct            NUMERIC(5,2),

  -- Cardiovascular
  systolic_bp             INTEGER,
  diastolic_bp            INTEGER,
  heart_rate              INTEGER,

  -- Lipid panel
  total_cholesterol       INTEGER,
  hdl_cholesterol         INTEGER,
  ldl_cholesterol         INTEGER,
  triglycerides           INTEGER,
  cholesterol_ratio       NUMERIC(4,2),       -- total / HDL

  -- Blood sugar
  blood_glucose           INTEGER,            -- mg/dL
  hba1c                   NUMERIC(4,1),

  -- Risk stratification (computed on save)
  bp_risk                 TEXT,  -- normal | elevated | high_1 | high_2 | crisis
  cholesterol_risk        TEXT,  -- normal | borderline | high | very_high
  glucose_risk            TEXT,  -- normal | prediabetes | diabetes
  bmi_category            TEXT,  -- underweight | normal | overweight | obese
  overall_risk            TEXT,  -- low | moderate | high

  notes                   TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ── Coaching Sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_sessions (
  id                SERIAL PRIMARY KEY,
  participant_id    INTEGER REFERENCES participants(id) ON DELETE CASCADE,
  coach_id          INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  duration_minutes  INTEGER DEFAULT 60,
  session_type      TEXT DEFAULT 'initial',    -- initial | follow_up | check_in | group
  status            TEXT DEFAULT 'scheduled',  -- scheduled | completed | cancelled | no_show
  intake_notes      TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Coaching Notes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_notes (
  id                    SERIAL PRIMARY KEY,
  session_id            INTEGER REFERENCES coaching_sessions(id) ON DELETE CASCADE UNIQUE,
  coach_id              INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
  stage_of_change       TEXT,
  -- precontemplation | contemplation | preparation | action | maintenance | relapse
  presenting_concern    TEXT,
  client_goals          TEXT,
  motivational_factors  TEXT,
  barriers              TEXT,
  action_steps          TEXT,
  follow_up_plan        TEXT,
  session_notes         TEXT,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── Goals ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id              SERIAL PRIMARY KEY,
  participant_id  INTEGER REFERENCES participants(id) ON DELETE CASCADE,
  coach_id        INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  category        TEXT DEFAULT 'other',
  -- nutrition | fitness | stress | sleep | biometric | medical | other
  target_date     DATE,
  status          TEXT DEFAULT 'active',
  -- active | achieved | paused | cancelled
  progress_notes  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Coach Availability ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_availability (
  id            SERIAL PRIMARY KEY,
  coach_id      INTEGER REFERENCES coaches(id) ON DELETE CASCADE,
  day_of_week   INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  active        BOOLEAN DEFAULT true,
  UNIQUE (coach_id, day_of_week, start_time)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_participants_org        ON participants(org_id);
CREATE INDEX IF NOT EXISTS idx_participants_coach      ON participants(assigned_coach_id);
CREATE INDEX IF NOT EXISTS idx_biometrics_participant  ON biometric_results(participant_id);
CREATE INDEX IF NOT EXISTS idx_biometrics_event        ON biometric_results(event_id);
CREATE INDEX IF NOT EXISTS idx_biometrics_screened_at  ON biometric_results(screened_at);
CREATE INDEX IF NOT EXISTS idx_sessions_participant    ON coaching_sessions(participant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_coach          ON coaching_sessions(coach_id);
CREATE INDEX IF NOT EXISTS idx_sessions_scheduled      ON coaching_sessions(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_goals_participant       ON goals(participant_id);
CREATE INDEX IF NOT EXISTS idx_events_org              ON screening_events(org_id);
CREATE INDEX IF NOT EXISTS idx_events_date             ON screening_events(event_date);
CREATE INDEX IF NOT EXISTS idx_availability_coach      ON coach_availability(coach_id);
