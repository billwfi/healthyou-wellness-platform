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
  phone       TEXT,
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
  id             SERIAL PRIMARY KEY,
  coach_id       INTEGER REFERENCES coaches(id) ON DELETE CASCADE,
  day_of_week    INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time     TIME NOT NULL,
  end_time       TIME NOT NULL,
  effective_from DATE,    -- first day of the month this block applies to
  effective_to   DATE,    -- last day of the month this block applies to
  active         BOOLEAN DEFAULT true
);

-- ── Organization Contacts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_contacts (
  id         SERIAL PRIMARY KEY,
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  title      TEXT,
  email      TEXT,
  phone      TEXT,
  role       TEXT DEFAULT 'contact',  -- primary | billing | hr | contact
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Organization Locations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_locations (
  id            SERIAL PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  zip           TEXT,
  phone         TEXT,
  location_type TEXT DEFAULT 'office',  -- office | warehouse | remote | clinic
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Departments ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
  id          SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES org_locations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  code        TEXT,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Eligibility ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eligibility (
  id               SERIAL PRIMARY KEY,
  org_id           INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id      TEXT,
  first_name       TEXT,
  last_name        TEXT,
  email            TEXT,
  date_of_birth    DATE,
  department       TEXT,
  location         TEXT,
  status           TEXT DEFAULT 'active',  -- active | inactive | terminated
  coverage_tier    TEXT,
  effective_date   DATE,
  termination_date DATE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
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
CREATE INDEX IF NOT EXISTS idx_contacts_org            ON org_contacts(org_id);
CREATE INDEX IF NOT EXISTS idx_locations_org           ON org_locations(org_id);
CREATE INDEX IF NOT EXISTS idx_departments_loc         ON departments(location_id);
CREATE INDEX IF NOT EXISTS idx_eligibility_org         ON eligibility(org_id);
CREATE INDEX IF NOT EXISTS idx_eligibility_email       ON eligibility(email);

-- ── Health Tips ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_tips (
  id                SERIAL PRIMARY KEY,
  title             TEXT NOT NULL,
  category          TEXT DEFAULT 'general',
  status            TEXT DEFAULT 'draft',   -- draft | published | archived
  author            TEXT,
  read_time_minutes INTEGER,
  summary           TEXT,
  content           TEXT,
  image_url         TEXT,
  tags              JSONB DEFAULT '[]',
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_health_tips_status   ON health_tips(status);
CREATE INDEX IF NOT EXISTS idx_health_tips_category ON health_tips(category);

-- ── Testimonials ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS testimonials (
  id               SERIAL PRIMARY KEY,
  participant_name TEXT NOT NULL,
  organization     TEXT,
  title_role       TEXT,
  status           TEXT DEFAULT 'draft',  -- draft | published | archived
  quote            TEXT,
  outcome          TEXT,
  photo_url        TEXT,
  rating           INTEGER CHECK (rating BETWEEN 1 AND 5),
  featured         BOOLEAN DEFAULT false,
  sort_order       INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_testimonials_status   ON testimonials(status);
CREATE INDEX IF NOT EXISTS idx_testimonials_featured ON testimonials(featured);

-- ── Content Library ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_library (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  resource_type TEXT DEFAULT 'article',   -- article | video | pdf | link | infographic | podcast
  category      TEXT DEFAULT 'general',
  status        TEXT DEFAULT 'published', -- published | draft | archived
  audience      TEXT DEFAULT 'all',       -- all | high_risk | moderate_risk | coaches
  url           TEXT,
  description   TEXT,
  author        TEXT,
  duration      TEXT,
  thumbnail_url TEXT,
  tags          JSONB DEFAULT '[]',
  featured      BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_library_status   ON content_library(status);
CREATE INDEX IF NOT EXISTS idx_library_category ON content_library(category);
CREATE INDEX IF NOT EXISTS idx_library_type     ON content_library(resource_type);

-- ── System Settings ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Event Registrations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_registrations (
  id                  SERIAL PRIMARY KEY,
  event_id            INTEGER NOT NULL REFERENCES screening_events(id) ON DELETE CASCADE,
  participant_id      INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  registered_at       TIMESTAMPTZ DEFAULT NOW(),
  registration_source TEXT DEFAULT 'manual',    -- csv | self | manual
  status              TEXT DEFAULT 'registered', -- registered | screened | no_show | cancelled
  UNIQUE (event_id, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_event_reg_event       ON event_registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_reg_participant ON event_registrations(participant_id);

-- ── Umbraco Content (imported from cosreachyourpeak.com) ──────────────────────
-- Communication › Umbraco. Full content tree pulled from the Umbraco CMS and
-- stored here so it can be browsed/searched inside the admin portal.
CREATE TABLE IF NOT EXISTS umbraco_content (
  id            SERIAL PRIMARY KEY,
  umb_id        INTEGER UNIQUE,           -- Umbraco node id
  umb_key       TEXT,                     -- Umbraco GUID key
  udi           TEXT,                     -- umb://document/{guid}
  name          TEXT NOT NULL,
  content_type  TEXT,                     -- document type alias (e.g. pageGlobal)
  parent_id     INTEGER,                  -- Umbraco parent node id (-1 for root)
  tree_path     TEXT,                     -- comma path e.g. -1,1328,1330
  level         INTEGER,                  -- depth in the tree
  sort_order    INTEGER,
  published     BOOLEAN DEFAULT true,
  update_date   TIMESTAMPTZ,              -- last edit date in Umbraco
  properties    JSONB DEFAULT '{}',       -- { alias: value } of every editor property
  raw           JSONB DEFAULT '{}',       -- full GetById payload (lossless)
  imported_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_umbraco_parent  ON umbraco_content(parent_id);
CREATE INDEX IF NOT EXISTS idx_umbraco_type     ON umbraco_content(content_type);
CREATE INDEX IF NOT EXISTS idx_umbraco_name     ON umbraco_content(name);

-- Emergent Risk acknowledgements: completed when a screening flags a Critical
-- Risk / Medical Emergency or Metabolic Syndrome (>=3). A copy is emailed to the
-- registrant. (Applied to the live SQL Server DB via a one-off CREATE TABLE.)
CREATE TABLE IF NOT EXISTS emergent_risk_forms (
  id                 SERIAL PRIMARY KEY,
  participant_id     INTEGER,
  event_id           INTEGER,
  risks              TEXT,
  metabolic_syndrome BOOLEAN,
  ms_count           INTEGER,
  follow_up          BOOLEAN,
  availability       TEXT,
  acknowledged       BOOLEAN,
  emailed_to         VARCHAR(256),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Documents attached to a screening record (PCP results, registrant-provided
-- blood work). Stored as base64 in `data` (small files; ~5 MB cap enforced in the
-- function). Applied to the live SQL Server DB via a one-off CREATE TABLE.
CREATE TABLE IF NOT EXISTS screening_documents (
  id             SERIAL PRIMARY KEY,
  participant_id INTEGER,
  event_id       INTEGER,
  filename       VARCHAR(255),
  content_type   VARCHAR(120),
  file_size      INTEGER,
  data           TEXT,
  uploaded_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_screening_documents_participant ON screening_documents(participant_id, event_id);

-- Event eligibility / flu-shot flags (applied to live SQL Server via ALTER TABLE):
--   screening_events.requires_eligibility BIT  -- verify registrants vs iStrata vw_full_eligibility (Active)
--   screening_events.offers_flu_shot      BIT  -- ask registrants if they want a flu shot
--   event_appointments.flu_shot           BIT  -- registrant's flu-shot answer (NULL = not asked)

-- Application users (admin Settings → User Management): role, assignable left-nav
-- categories (JSON), and portal access. Applied to live SQL Server via CREATE TABLE.
CREATE TABLE IF NOT EXISTS app_users (
  id              SERIAL PRIMARY KEY,
  first_name      VARCHAR(100),
  last_name       VARCHAR(100),
  phone           VARCHAR(40),
  email           VARCHAR(256),
  role            VARCHAR(40),               -- Admin | User | Health Coach
  nav_categories  TEXT,                      -- JSON array of nav category keys
  coach_portal    BOOLEAN DEFAULT FALSE,
  screener_portal BOOLEAN DEFAULT FALSE,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Flu-shot consent review captured on the screening form when the event offers flu shots.
-- ALTER TABLE biometric_results ADD flu_consent_reviewed BIT NULL;  (applied to live SQL Server)
