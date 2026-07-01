-- HealYou Wellness Platform — SQL Server schema (hy_datawarehouse, dbo)
-- Converted from the original Neon/PostgreSQL schema (schema.sql).
-- Type mapping: SERIAL->INT IDENTITY, TEXT->NVARCHAR, BOOLEAN->BIT,
--   TIMESTAMPTZ->DATETIME2(3), NUMERIC->DECIMAL, JSONB->NVARCHAR(MAX),
--   NOW()->SYSUTCDATETIME().
-- Foreign keys are added by scripts/setup-sqlserver-schema.js (with NO ACTION
-- fallback where SQL Server rejects multiple cascade paths).
-- Each statement batch is separated by GO.

-- ── Organizations ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.organizations','U') IS NULL
CREATE TABLE dbo.organizations (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  name          NVARCHAR(255) NOT NULL,
  slug          NVARCHAR(255) NOT NULL UNIQUE,
  contact_name  NVARCHAR(255),
  contact_email NVARCHAR(255),
  active        BIT DEFAULT 1,
  created_at    DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ── Coaches ───────────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.coaches','U') IS NULL
CREATE TABLE dbo.coaches (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  email       NVARCHAR(255) NOT NULL UNIQUE,
  name        NVARCHAR(255) NOT NULL,
  bio         NVARCHAR(MAX),
  avatar_url  NVARCHAR(MAX),
  specialty   NVARCHAR(255),
  phone       NVARCHAR(50),
  active      BIT DEFAULT 1,
  created_at  DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ── Participants ──────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.participants','U') IS NULL
CREATE TABLE dbo.participants (
  id                INT IDENTITY(1,1) PRIMARY KEY,
  org_id            INT,
  assigned_coach_id INT,
  email             NVARCHAR(255) NOT NULL UNIQUE,
  first_name        NVARCHAR(255) NOT NULL,
  last_name         NVARCHAR(255) NOT NULL,
  date_of_birth     DATE,
  gender            NVARCHAR(50),
  phone             NVARCHAR(50),
  employee_id       NVARCHAR(100),
  department        NVARCHAR(255),
  active            BIT DEFAULT 1,
  created_at        DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ── Screening Events ─────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.screening_events','U') IS NULL
CREATE TABLE dbo.screening_events (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  org_id      INT,
  name        NVARCHAR(255) NOT NULL,
  event_date  DATE NOT NULL,
  location    NVARCHAR(255),
  event_type  NVARCHAR(50) DEFAULT 'onsite',
  status      NVARCHAR(50) DEFAULT 'scheduled',
  notes       NVARCHAR(MAX),
  created_at  DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- Event category (Screening Event / Flu Clinic / Lunch & Learn …) — distinct from the
-- legacy event_type modality column. Options live in dbo.event_categories (extensible).
IF COL_LENGTH('dbo.screening_events','event_category') IS NULL ALTER TABLE dbo.screening_events ADD event_category NVARCHAR(100);
GO
UPDATE dbo.screening_events SET event_category='Screening Event' WHERE event_category IS NULL;
GO

IF OBJECT_ID('dbo.event_categories','U') IS NULL
CREATE TABLE dbo.event_categories (
  id         INT IDENTITY(1,1) PRIMARY KEY,
  name       NVARCHAR(100) NOT NULL UNIQUE,
  active     BIT DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO
-- Seed the starter categories (idempotent).
MERGE dbo.event_categories AS t
USING (VALUES ('Screening Event',0),('Flu Clinic',1),('Lunch & Learn',2)) AS s(name,sort_order)
  ON t.name=s.name
WHEN NOT MATCHED THEN INSERT (name,sort_order) VALUES (s.name,s.sort_order);
GO

-- ── Biometric Results ─────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.biometric_results','U') IS NULL
CREATE TABLE dbo.biometric_results (
  id                      INT IDENTITY(1,1) PRIMARY KEY,
  participant_id          INT,
  event_id                INT,
  screened_by             INT,
  screened_at             DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  height_in               DECIMAL(5,1),
  weight_lbs              DECIMAL(6,1),
  bmi                     DECIMAL(5,2),
  waist_circumference_in  DECIMAL(5,1),
  body_fat_pct            DECIMAL(5,2),
  systolic_bp             INT,
  diastolic_bp            INT,
  heart_rate              INT,
  total_cholesterol       INT,
  hdl_cholesterol         INT,
  ldl_cholesterol         INT,
  triglycerides           INT,
  cholesterol_ratio       DECIMAL(4,2),
  blood_glucose           INT,
  hba1c                   DECIMAL(4,1),
  bp_risk                 NVARCHAR(50),
  cholesterol_risk        NVARCHAR(50),
  glucose_risk            NVARCHAR(50),
  bmi_category            NVARCHAR(50),
  overall_risk            NVARCHAR(50),
  notes                   NVARCHAR(MAX),
  created_at              DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ── Coaching Sessions ─────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.coaching_sessions','U') IS NULL
CREATE TABLE dbo.coaching_sessions (
  id                INT IDENTITY(1,1) PRIMARY KEY,
  participant_id    INT,
  coach_id          INT,
  scheduled_at      DATETIME2(3) NOT NULL,
  duration_minutes  INT DEFAULT 30,
  session_type      NVARCHAR(50) DEFAULT 'initial',
  status            NVARCHAR(50) DEFAULT 'scheduled',
  intake_notes      NVARCHAR(MAX),
  created_at        DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ── Coaching Notes ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.coaching_notes','U') IS NULL
CREATE TABLE dbo.coaching_notes (
  id                    INT IDENTITY(1,1) PRIMARY KEY,
  session_id            INT,
  coach_id              INT,
  stage_of_change       NVARCHAR(50),
  presenting_concern    NVARCHAR(MAX),
  client_goals          NVARCHAR(MAX),
  motivational_factors  NVARCHAR(MAX),
  barriers              NVARCHAR(MAX),
  action_steps          NVARCHAR(MAX),
  follow_up_plan        NVARCHAR(MAX),
  session_notes         NVARCHAR(MAX),
  updated_at            DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO
-- session_id unique (filtered to match Postgres multi-NULL semantics)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='uq_coaching_notes_session')
CREATE UNIQUE INDEX uq_coaching_notes_session ON dbo.coaching_notes(session_id) WHERE session_id IS NOT NULL;
GO

-- ── Goals ─────────────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.goals','U') IS NULL
CREATE TABLE dbo.goals (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  participant_id  INT,
  coach_id        INT,
  title           NVARCHAR(255) NOT NULL,
  description     NVARCHAR(MAX),
  category        NVARCHAR(50) DEFAULT 'other',
  target_date     DATE,
  status          NVARCHAR(50) DEFAULT 'active',
  progress_notes  NVARCHAR(MAX),
  created_at      DATETIME2(3) DEFAULT SYSUTCDATETIME(),
  updated_at      DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ── Coach Availability ────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.coach_availability','U') IS NULL
CREATE TABLE dbo.coach_availability (
  id             INT IDENTITY(1,1) PRIMARY KEY,
  coach_id       INT,
  day_of_week    INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time     TIME NOT NULL,
  end_time       TIME NOT NULL,
  effective_from DATE,
  effective_to   DATE,
  active         BIT DEFAULT 1
);
GO

-- ── Organization Contacts ────────────────────────────────────────────────────
IF OBJECT_ID('dbo.org_contacts','U') IS NULL
CREATE TABLE dbo.org_contacts (
  id         INT IDENTITY(1,1) PRIMARY KEY,
  org_id     INT NOT NULL,
  name       NVARCHAR(255) NOT NULL,
  title      NVARCHAR(255),
  email      NVARCHAR(255),
  phone      NVARCHAR(50),
  role       NVARCHAR(50) DEFAULT 'contact',
  active     BIT DEFAULT 1,
  created_at DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ── Organization Locations ────────────────────────────────────────────────────
IF OBJECT_ID('dbo.org_locations','U') IS NULL
CREATE TABLE dbo.org_locations (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  org_id        INT NOT NULL,
  name          NVARCHAR(255) NOT NULL,
  address       NVARCHAR(MAX),
  city          NVARCHAR(100),
  state         NVARCHAR(50),
  zip           NVARCHAR(20),
  phone         NVARCHAR(50),
  location_type NVARCHAR(50) DEFAULT 'office',
  active        BIT DEFAULT 1,
  created_at    DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ── Departments ───────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.departments','U') IS NULL
CREATE TABLE dbo.departments (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  location_id INT NOT NULL,
  name        NVARCHAR(255) NOT NULL,
  code        NVARCHAR(100),
  active      BIT DEFAULT 1,
  created_at  DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ── Eligibility ──────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.eligibility','U') IS NULL
CREATE TABLE dbo.eligibility (
  id               INT IDENTITY(1,1) PRIMARY KEY,
  org_id           INT NOT NULL,
  employee_id      NVARCHAR(100),
  first_name       NVARCHAR(255),
  last_name        NVARCHAR(255),
  email            NVARCHAR(255),
  date_of_birth    DATE,
  department       NVARCHAR(255),
  location         NVARCHAR(255),
  status           NVARCHAR(50) DEFAULT 'active',
  coverage_tier    NVARCHAR(100),
  effective_date   DATE,
  termination_date DATE,
  created_at       DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ── Health Tips ───────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.health_tips','U') IS NULL
CREATE TABLE dbo.health_tips (
  id                INT IDENTITY(1,1) PRIMARY KEY,
  title             NVARCHAR(255) NOT NULL,
  category          NVARCHAR(100) DEFAULT 'general',
  status            NVARCHAR(50) DEFAULT 'draft',
  author            NVARCHAR(255),
  read_time_minutes INT,
  summary           NVARCHAR(MAX),
  content           NVARCHAR(MAX),
  image_url         NVARCHAR(MAX),
  tags              NVARCHAR(MAX) DEFAULT '[]',
  published_at      DATETIME2(3),
  created_at        DATETIME2(3) DEFAULT SYSUTCDATETIME(),
  updated_at        DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ── Testimonials ──────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.testimonials','U') IS NULL
CREATE TABLE dbo.testimonials (
  id               INT IDENTITY(1,1) PRIMARY KEY,
  participant_name NVARCHAR(255) NOT NULL,
  organization     NVARCHAR(255),
  title_role       NVARCHAR(255),
  status           NVARCHAR(50) DEFAULT 'draft',
  quote            NVARCHAR(MAX),
  outcome          NVARCHAR(MAX),
  photo_url        NVARCHAR(MAX),
  rating           INT CHECK (rating BETWEEN 1 AND 5),
  featured         BIT DEFAULT 0,
  sort_order       INT DEFAULT 0,
  created_at       DATETIME2(3) DEFAULT SYSUTCDATETIME(),
  updated_at       DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ── Content Library ───────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.content_library','U') IS NULL
CREATE TABLE dbo.content_library (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  title         NVARCHAR(255) NOT NULL,
  resource_type NVARCHAR(50) DEFAULT 'article',
  category      NVARCHAR(100) DEFAULT 'general',
  status        NVARCHAR(50) DEFAULT 'published',
  audience      NVARCHAR(50) DEFAULT 'all',
  url           NVARCHAR(MAX),
  description   NVARCHAR(MAX),
  author        NVARCHAR(255),
  duration      NVARCHAR(50),
  thumbnail_url NVARCHAR(MAX),
  tags          NVARCHAR(MAX) DEFAULT '[]',
  featured      BIT DEFAULT 0,
  created_at    DATETIME2(3) DEFAULT SYSUTCDATETIME(),
  updated_at    DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ── System Settings ───────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.system_settings','U') IS NULL
CREATE TABLE dbo.system_settings (
  [key]      NVARCHAR(255) PRIMARY KEY,
  value      NVARCHAR(MAX),
  updated_at DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ── Event Registrations ───────────────────────────────────────────────────────
IF OBJECT_ID('dbo.event_registrations','U') IS NULL
CREATE TABLE dbo.event_registrations (
  id                  INT IDENTITY(1,1) PRIMARY KEY,
  event_id            INT NOT NULL,
  participant_id      INT NOT NULL,
  registered_at       DATETIME2(3) DEFAULT SYSUTCDATETIME(),
  registration_source NVARCHAR(50) DEFAULT 'manual',
  status              NVARCHAR(50) DEFAULT 'registered',
  CONSTRAINT uq_event_reg UNIQUE (event_id, participant_id)
);
GO

-- ── Umbraco Content ───────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.umbraco_content','U') IS NULL
CREATE TABLE dbo.umbraco_content (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  umb_id        INT,
  umb_key       NVARCHAR(255),
  udi           NVARCHAR(255),
  name          NVARCHAR(400) NOT NULL,
  content_type  NVARCHAR(255),
  parent_id     INT,
  tree_path     NVARCHAR(MAX),
  level         INT,
  sort_order    INT,
  published     BIT DEFAULT 1,
  update_date   DATETIME2(3),
  properties    NVARCHAR(MAX) DEFAULT '{}',
  raw           NVARCHAR(MAX) DEFAULT '{}',
  imported_at   DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='uq_umbraco_umb_id')
CREATE UNIQUE INDEX uq_umbraco_umb_id ON dbo.umbraco_content(umb_id) WHERE umb_id IS NOT NULL;
GO

-- ── Indexes ───────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_participants_org')        CREATE INDEX idx_participants_org        ON dbo.participants(org_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_participants_coach')      CREATE INDEX idx_participants_coach      ON dbo.participants(assigned_coach_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_biometrics_participant')  CREATE INDEX idx_biometrics_participant  ON dbo.biometric_results(participant_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_biometrics_event')        CREATE INDEX idx_biometrics_event        ON dbo.biometric_results(event_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_biometrics_screened_at')  CREATE INDEX idx_biometrics_screened_at  ON dbo.biometric_results(screened_at);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_sessions_participant')    CREATE INDEX idx_sessions_participant    ON dbo.coaching_sessions(participant_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_sessions_coach')          CREATE INDEX idx_sessions_coach          ON dbo.coaching_sessions(coach_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_sessions_scheduled')      CREATE INDEX idx_sessions_scheduled      ON dbo.coaching_sessions(scheduled_at);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_goals_participant')       CREATE INDEX idx_goals_participant       ON dbo.goals(participant_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_events_org')              CREATE INDEX idx_events_org              ON dbo.screening_events(org_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_events_date')             CREATE INDEX idx_events_date             ON dbo.screening_events(event_date);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_availability_coach')      CREATE INDEX idx_availability_coach      ON dbo.coach_availability(coach_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_contacts_org')            CREATE INDEX idx_contacts_org            ON dbo.org_contacts(org_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_locations_org')           CREATE INDEX idx_locations_org           ON dbo.org_locations(org_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_departments_loc')         CREATE INDEX idx_departments_loc         ON dbo.departments(location_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_eligibility_org')         CREATE INDEX idx_eligibility_org         ON dbo.eligibility(org_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_eligibility_email')       CREATE INDEX idx_eligibility_email       ON dbo.eligibility(email);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_health_tips_status')      CREATE INDEX idx_health_tips_status      ON dbo.health_tips(status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_health_tips_category')    CREATE INDEX idx_health_tips_category    ON dbo.health_tips(category);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_testimonials_status')     CREATE INDEX idx_testimonials_status     ON dbo.testimonials(status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_testimonials_featured')   CREATE INDEX idx_testimonials_featured   ON dbo.testimonials(featured);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_library_status')          CREATE INDEX idx_library_status          ON dbo.content_library(status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_library_category')        CREATE INDEX idx_library_category        ON dbo.content_library(category);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_library_type')            CREATE INDEX idx_library_type            ON dbo.content_library(resource_type);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_event_reg_event')         CREATE INDEX idx_event_reg_event         ON dbo.event_registrations(event_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_event_reg_participant')   CREATE INDEX idx_event_reg_participant   ON dbo.event_registrations(participant_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_umbraco_parent')          CREATE INDEX idx_umbraco_parent          ON dbo.umbraco_content(parent_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_umbraco_type')            CREATE INDEX idx_umbraco_type            ON dbo.umbraco_content(content_type);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_umbraco_name')            CREATE INDEX idx_umbraco_name            ON dbo.umbraco_content(name);
GO

-- ════════════════════════════════════════════════════════════════════════════
-- Schedule Setup (AppointmentQuest parity) — additive columns on screening_events
-- plus event_* child tables. All guarded so this file stays idempotent.
-- ════════════════════════════════════════════════════════════════════════════

-- General
IF COL_LENGTH('dbo.screening_events','description') IS NULL                ALTER TABLE dbo.screening_events ADD description NVARCHAR(MAX);
GO
IF COL_LENGTH('dbo.screening_events','custom_form') IS NULL                ALTER TABLE dbo.screening_events ADD custom_form NVARCHAR(255);
GO
IF COL_LENGTH('dbo.screening_events','schedule_status') IS NULL            ALTER TABLE dbo.screening_events ADD schedule_status NVARCHAR(20) DEFAULT 'active';
GO
IF COL_LENGTH('dbo.screening_events','capacity_type') IS NULL              ALTER TABLE dbo.screening_events ADD capacity_type NVARCHAR(50) DEFAULT 'capacity';
GO
-- Settings
IF COL_LENGTH('dbo.screening_events','concurrent_limit') IS NULL           ALTER TABLE dbo.screening_events ADD concurrent_limit INT DEFAULT 1;
GO
IF COL_LENGTH('dbo.screening_events','valid_from') IS NULL                 ALTER TABLE dbo.screening_events ADD valid_from DATE;
GO
IF COL_LENGTH('dbo.screening_events','valid_to') IS NULL                   ALTER TABLE dbo.screening_events ADD valid_to DATE;
GO
IF COL_LENGTH('dbo.screening_events','service_location_selection') IS NULL ALTER TABLE dbo.screening_events ADD service_location_selection NVARCHAR(20) DEFAULT 'required';
GO
-- Availability
IF COL_LENGTH('dbo.screening_events','appointment_interval_min') IS NULL   ALTER TABLE dbo.screening_events ADD appointment_interval_min INT DEFAULT 30;
GO
IF COL_LENGTH('dbo.screening_events','service_duration_min') IS NULL       ALTER TABLE dbo.screening_events ADD service_duration_min INT DEFAULT 30;
GO
IF COL_LENGTH('dbo.screening_events','service_duration_flexible') IS NULL  ALTER TABLE dbo.screening_events ADD service_duration_flexible BIT DEFAULT 0;
GO
IF COL_LENGTH('dbo.screening_events','overlap_allowed') IS NULL            ALTER TABLE dbo.screening_events ADD overlap_allowed BIT DEFAULT 0;
GO
IF COL_LENGTH('dbo.screening_events','group_scheduling') IS NULL           ALTER TABLE dbo.screening_events ADD group_scheduling BIT DEFAULT 0;
GO
IF COL_LENGTH('dbo.screening_events','capacity_uniform') IS NULL           ALTER TABLE dbo.screening_events ADD capacity_uniform BIT DEFAULT 1;
GO
IF COL_LENGTH('dbo.screening_events','uniform_capacity') IS NULL           ALTER TABLE dbo.screening_events ADD uniform_capacity INT;
GO
-- Notifications
IF COL_LENGTH('dbo.screening_events','notify_customers') IS NULL           ALTER TABLE dbo.screening_events ADD notify_customers BIT DEFAULT 1;
GO
-- Payments
IF COL_LENGTH('dbo.screening_events','payment_required') IS NULL           ALTER TABLE dbo.screening_events ADD payment_required BIT DEFAULT 0;
GO
IF COL_LENGTH('dbo.screening_events','payment_amount') IS NULL             ALTER TABLE dbo.screening_events ADD payment_amount DECIMAL(10,2);
GO
IF COL_LENGTH('dbo.screening_events','payment_instructions') IS NULL       ALTER TABLE dbo.screening_events ADD payment_instructions NVARCHAR(MAX);
GO
-- Internal/External appointment-rules matrix (JSON blob)
IF COL_LENGTH('dbo.screening_events','appointment_rules') IS NULL          ALTER TABLE dbo.screening_events ADD appointment_rules NVARCHAR(MAX);
GO

-- ════════════════════════════════════════════════════════════════════════════
-- Event container + per-location model (medallus-style). screening_events is a
-- container (Group + start/end dates + public_slug); each event_locations row is
-- a first-class location carrying its OWN full AppointmentQuest Setup. The
-- per-event Setup columns above are deprecated (kept, unused). The child tables
-- below (business hours / availability / notification recipients) are keyed by
-- location_id, not event_id.
-- ════════════════════════════════════════════════════════════════════════════
IF COL_LENGTH('dbo.screening_events','start_date') IS NULL   ALTER TABLE dbo.screening_events ADD start_date DATE;
GO
IF COL_LENGTH('dbo.screening_events','end_date') IS NULL     ALTER TABLE dbo.screening_events ADD end_date DATE;
GO
IF COL_LENGTH('dbo.screening_events','public_slug') IS NULL  ALTER TABLE dbo.screening_events ADD public_slug NVARCHAR(40);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='uq_events_public_slug')
CREATE UNIQUE INDEX uq_events_public_slug ON dbo.screening_events(public_slug) WHERE public_slug IS NOT NULL;
GO

IF OBJECT_ID('dbo.event_locations','U') IS NULL
CREATE TABLE dbo.event_locations (
  id               INT IDENTITY(1,1) PRIMARY KEY,
  event_id         INT NOT NULL,
  name             NVARCHAR(255) NOT NULL,
  address          NVARCHAR(MAX),
  city             NVARCHAR(100),
  state            NVARCHAR(50),
  zip              NVARCHAR(20),
  phone            NVARCHAR(50),
  sort_order       INT DEFAULT 0,
  max_participants INT,
  -- Full AppointmentQuest Setup, per location (mirrors the event-setup scalars)
  description                NVARCHAR(MAX),
  custom_form                NVARCHAR(255),
  schedule_status            NVARCHAR(20) DEFAULT 'active',
  capacity_type              NVARCHAR(50) DEFAULT 'capacity',
  concurrent_limit           INT DEFAULT 1,
  valid_from                 DATE,
  valid_to                   DATE,
  service_location_selection NVARCHAR(20) DEFAULT 'required',
  appointment_interval_min   INT DEFAULT 30,
  service_duration_min       INT DEFAULT 30,
  service_duration_flexible  BIT DEFAULT 0,
  overlap_allowed            BIT DEFAULT 0,
  group_scheduling           BIT DEFAULT 0,
  capacity_uniform           BIT DEFAULT 1,
  uniform_capacity           INT,
  notify_customers           BIT DEFAULT 1,
  payment_required           BIT DEFAULT 0,
  payment_amount             DECIMAL(10,2),
  payment_instructions       NVARCHAR(MAX),
  appointment_rules          NVARCHAR(MAX),
  created_at       DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_event_locations_event') CREATE INDEX idx_event_locations_event ON dbo.event_locations(event_id);
GO

-- ── Business Hours (multiple rows per day = "Split"), per location ────────────
IF OBJECT_ID('dbo.event_business_hours','U') IS NULL
CREATE TABLE dbo.event_business_hours (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  location_id INT NOT NULL,
  day_of_week INT NOT NULL,          -- 0=Sun … 6=Sat
  is_open     BIT DEFAULT 0,
  from_time   TIME,
  to_time     TIME,
  sort_order  INT DEFAULT 0
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_event_hours_loc') CREATE INDEX idx_event_hours_loc ON dbo.event_business_hours(location_id);
GO

-- ── Availability slots (per time-slot capacity grid), per location ────────────
IF OBJECT_ID('dbo.event_availability_slots','U') IS NULL
CREATE TABLE dbo.event_availability_slots (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  location_id INT NOT NULL,
  day_of_week INT NOT NULL,
  start_time  TIME NOT NULL,
  capacity    INT DEFAULT 1
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_event_slots_loc') CREATE INDEX idx_event_slots_loc ON dbo.event_availability_slots(location_id);
GO

-- ── Notification recipients (staff), per location ─────────────────────────────
IF OBJECT_ID('dbo.event_notification_recipients','U') IS NULL
CREATE TABLE dbo.event_notification_recipients (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  location_id INT NOT NULL,
  name        NVARCHAR(255),
  email       NVARCHAR(255)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_event_notif_loc') CREATE INDEX idx_event_notif_loc ON dbo.event_notification_recipients(location_id);
GO

-- ════════════════════════════════════════════════════════════════════════════
-- Screening data additions — fasting/pregnant flags, waist-to-height ratio,
-- non-HDL cholesterol. (body_fat_pct stays for historical rows but is no longer
-- captured in the entry form.) All additive / guarded.
-- ════════════════════════════════════════════════════════════════════════════
IF COL_LENGTH('dbo.biometric_results','fasting_flag') IS NULL           ALTER TABLE dbo.biometric_results ADD fasting_flag BIT;
GO
IF COL_LENGTH('dbo.biometric_results','pregnant') IS NULL               ALTER TABLE dbo.biometric_results ADD pregnant BIT;
GO
IF COL_LENGTH('dbo.biometric_results','diabetic') IS NULL               ALTER TABLE dbo.biometric_results ADD diabetic BIT;
GO
IF COL_LENGTH('dbo.biometric_results','risk_score') IS NULL             ALTER TABLE dbo.biometric_results ADD risk_score INT;
GO
IF COL_LENGTH('dbo.biometric_results','risk_json') IS NULL              ALTER TABLE dbo.biometric_results ADD risk_json NVARCHAR(MAX);
GO
IF COL_LENGTH('dbo.biometric_results','non_hdl') IS NULL                ALTER TABLE dbo.biometric_results ADD non_hdl INT;
GO
IF COL_LENGTH('dbo.biometric_results','waist_height_ratio') IS NULL     ALTER TABLE dbo.biometric_results ADD waist_height_ratio DECIMAL(4,2);
GO
IF COL_LENGTH('dbo.biometric_results','waist_height_category') IS NULL  ALTER TABLE dbo.biometric_results ADD waist_height_category NVARCHAR(20);
GO
IF COL_LENGTH('dbo.biometric_results','grip_strength') IS NULL          ALTER TABLE dbo.biometric_results ADD grip_strength DECIMAL(5,1);
GO
-- Lifestyle Risk Assessment (screener entry)
IF COL_LENGTH('dbo.biometric_results','fruit_veg_servings') IS NULL     ALTER TABLE dbo.biometric_results ADD fruit_veg_servings INT;
GO
IF COL_LENGTH('dbo.biometric_results','activity_minutes') IS NULL       ALTER TABLE dbo.biometric_results ADD activity_minutes INT;
GO
IF COL_LENGTH('dbo.biometric_results','muscle_strengthening') IS NULL   ALTER TABLE dbo.biometric_results ADD muscle_strengthening BIT;
GO
IF COL_LENGTH('dbo.biometric_results','stress_level') IS NULL           ALTER TABLE dbo.biometric_results ADD stress_level INT;
GO
IF COL_LENGTH('dbo.biometric_results','alcohol_drinks') IS NULL         ALTER TABLE dbo.biometric_results ADD alcohol_drinks INT;
GO
IF COL_LENGTH('dbo.biometric_results','tobacco_use') IS NULL            ALTER TABLE dbo.biometric_results ADD tobacco_use BIT;
GO
IF COL_LENGTH('dbo.biometric_results','sleep_hours') IS NULL            ALTER TABLE dbo.biometric_results ADD sleep_hours DECIMAL(4,1);
GO
-- One screening record per participant per event (ad-hoc null-event rows exempt)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ux_bio_participant_event' AND object_id=OBJECT_ID('dbo.biometric_results'))
  CREATE UNIQUE INDEX ux_bio_participant_event ON dbo.biometric_results(participant_id,event_id) WHERE event_id IS NOT NULL;
GO

-- ════════════════════════════════════════════════════════════════════════════
-- Forms (builder) + assignment to events (shown during public registration).
-- ════════════════════════════════════════════════════════════════════════════
IF OBJECT_ID('dbo.forms','U') IS NULL
CREATE TABLE dbo.forms (
  id           INT IDENTITY(1,1) PRIMARY KEY,
  name         NVARCHAR(255) NOT NULL,
  description  NVARCHAR(MAX),
  body_html    NVARCHAR(MAX),                            -- WYSIWYG content shown above the fields
  requires_ack BIT DEFAULT 0,                            -- 1 = participant must acknowledge; 0 = information only
  schema_json  NVARCHAR(MAX) DEFAULT '{"fields":[]}',    -- { fields:[{key,type,label,required,options}] }
  active       BIT DEFAULT 1,
  created_at   DATETIME2(3) DEFAULT SYSUTCDATETIME(),
  updated_at   DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO
-- Backfill columns on existing installations.
IF COL_LENGTH('dbo.forms','body_html')    IS NULL ALTER TABLE dbo.forms ADD body_html    NVARCHAR(MAX);
GO
IF COL_LENGTH('dbo.forms','requires_ack') IS NULL ALTER TABLE dbo.forms ADD requires_ack BIT DEFAULT 0;
GO

IF OBJECT_ID('dbo.event_forms','U') IS NULL
CREATE TABLE dbo.event_forms (
  event_id   INT NOT NULL,
  form_id    INT NOT NULL,
  sort_order INT DEFAULT 0,
  CONSTRAINT pk_event_forms PRIMARY KEY (event_id, form_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_event_forms_form') CREATE INDEX idx_event_forms_form ON dbo.event_forms(form_id);
GO

-- ════════════════════════════════════════════════════════════════════════════
-- Public registration: an appointment booked at a specific event LOCATION + time,
-- with the answers to the event's assigned forms and any uploaded files.
-- ════════════════════════════════════════════════════════════════════════════
IF OBJECT_ID('dbo.event_appointments','U') IS NULL
CREATE TABLE dbo.event_appointments (
  id               INT IDENTITY(1,1) PRIMARY KEY,
  event_id         INT NOT NULL,
  location_id      INT NOT NULL,
  first_name       NVARCHAR(100) NOT NULL,
  last_name        NVARCHAR(100) NOT NULL,
  email            NVARCHAR(255),
  phone            NVARCHAR(30),
  appointment_date DATE,
  appointment_time TIME,
  date_of_birth    DATE,
  gender           NVARCHAR(20),
  status           NVARCHAR(20) DEFAULT 'registered',   -- registered | cancelled
  magic_token      NVARCHAR(64),                        -- cancel/reschedule (Phase 4)
  created_at       DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO
IF COL_LENGTH('dbo.event_appointments','date_of_birth') IS NULL ALTER TABLE dbo.event_appointments ADD date_of_birth DATE;
GO
IF COL_LENGTH('dbo.event_appointments','gender')        IS NULL ALTER TABLE dbo.event_appointments ADD gender NVARCHAR(20);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_appt_event') CREATE INDEX idx_appt_event ON dbo.event_appointments(event_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_appt_slot')  CREATE INDEX idx_appt_slot  ON dbo.event_appointments(location_id, appointment_date, appointment_time, status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='uq_appt_token')  CREATE UNIQUE INDEX uq_appt_token ON dbo.event_appointments(magic_token) WHERE magic_token IS NOT NULL;
GO

-- Appointment activity log (drives the daily digest: registered/cancelled/rescheduled/updated).
IF OBJECT_ID('dbo.event_appointment_activity','U') IS NULL
CREATE TABLE dbo.event_appointment_activity (
  id             INT IDENTITY(1,1) PRIMARY KEY,
  appointment_id INT NOT NULL,
  action         NVARCHAR(20) NOT NULL,
  detail         NVARCHAR(255),
  at             DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_appt_activity') CREATE INDEX idx_appt_activity ON dbo.event_appointment_activity(action, at);
GO

IF OBJECT_ID('dbo.event_appointment_answers','U') IS NULL
CREATE TABLE dbo.event_appointment_answers (
  id             INT IDENTITY(1,1) PRIMARY KEY,
  appointment_id INT NOT NULL,
  form_id        INT,
  answers_json   NVARCHAR(MAX)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_appt_ans_appt') CREATE INDEX idx_appt_ans_appt ON dbo.event_appointment_answers(appointment_id);
GO

IF OBJECT_ID('dbo.event_appointment_documents','U') IS NULL
CREATE TABLE dbo.event_appointment_documents (
  id             INT IDENTITY(1,1) PRIMARY KEY,
  appointment_id INT NOT NULL,
  field_key      NVARCHAR(100),
  file_name      NVARCHAR(400),
  content_type   NVARCHAR(200),
  content        VARBINARY(MAX),
  uploaded_at    DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_appt_doc_appt') CREATE INDEX idx_appt_doc_appt ON dbo.event_appointment_documents(appointment_id);
GO

-- Legacy per-event inline email (superseded by reusable email_templates below; columns kept for back-compat).
IF COL_LENGTH('dbo.screening_events','email_subject') IS NULL ALTER TABLE dbo.screening_events ADD email_subject NVARCHAR(500);
GO
IF COL_LENGTH('dbo.screening_events','email_html') IS NULL    ALTER TABLE dbo.screening_events ADD email_html NVARCHAR(MAX);
GO

-- ════════════════════════════════════════════════════════════════════════════
-- Reusable email templates (WYSIWYG body + subject), assignable to events.
-- ════════════════════════════════════════════════════════════════════════════
IF OBJECT_ID('dbo.email_templates','U') IS NULL
CREATE TABLE dbo.email_templates (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  name        NVARCHAR(255) NOT NULL,
  description NVARCHAR(MAX),
  subject     NVARCHAR(500),
  body_html   NVARCHAR(MAX),
  active      BIT DEFAULT 1,
  created_at  DATETIME2(3) DEFAULT SYSUTCDATETIME(),
  updated_at  DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO
-- An event points at the email template used for its confirmation email.
IF COL_LENGTH('dbo.screening_events','email_template_id') IS NULL ALTER TABLE dbo.screening_events ADD email_template_id INT;
GO

-- ════════════════════════════════════════════════════════════════════════════
-- Application users (admin Settings → User Management + admin portal login).
-- password_hash stores a scrypt hash: scrypt$<salt>$<hash> (see functions/users.js
-- and functions/login.js). Login authenticates against this table.
-- ════════════════════════════════════════════════════════════════════════════
IF OBJECT_ID('dbo.app_users','U') IS NULL
CREATE TABLE dbo.app_users (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  first_name      NVARCHAR(100),
  last_name       NVARCHAR(100),
  phone           NVARCHAR(40),
  email           NVARCHAR(256),
  role            NVARCHAR(40),              -- Admin | User | Health Coach
  nav_categories  NVARCHAR(MAX),             -- JSON array of nav category keys
  coach_portal    BIT DEFAULT 0,
  screener_portal BIT DEFAULT 0,
  active          BIT DEFAULT 1,
  password_hash   NVARCHAR(MAX),             -- scrypt$<salt>$<hash>
  created_at      DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO
-- Add password_hash to pre-existing app_users tables that predate password login.
IF COL_LENGTH('dbo.app_users','password_hash') IS NULL ALTER TABLE dbo.app_users ADD password_hash NVARCHAR(MAX);
GO

-- ════════════════════════════════════════════════════════════════════════════
-- Coach availability EXCEPTIONS — overrides on top of the recurring weekly
-- coach_availability blocks. An exception is either a single date (exception_date)
-- or a monthly ordinal (day_of_week + week_of_month, e.g. the 1st Monday). Effect
-- is 'off' (unavailable that occurrence) or 'custom' (use start_time/end_time
-- instead). Consumed by functions/available-slots.js.
--   week_of_month: 1..5 = that ordinal weekday; 0 = the LAST such weekday.
-- ════════════════════════════════════════════════════════════════════════════
IF OBJECT_ID('dbo.coach_availability_exceptions','U') IS NULL
CREATE TABLE dbo.coach_availability_exceptions (
  id             INT IDENTITY(1,1) PRIMARY KEY,
  coach_id       INT NOT NULL,
  exception_date DATE NULL,          -- single-date exception
  day_of_week    INT NULL,           -- monthly-ordinal: 0=Sun..6=Sat
  week_of_month  INT NULL,           -- 1..5 = ordinal, 0 = last
  kind           NVARCHAR(10) NOT NULL DEFAULT 'off',  -- 'off' | 'custom'
  start_time     TIME NULL,          -- for kind='custom'
  end_time       TIME NULL,
  effective_from DATE NULL,          -- optional bounds for a recurring exception
  effective_to   DATE NULL,
  active         BIT DEFAULT 1,
  created_at     DATETIME2(3) DEFAULT SYSUTCDATETIME()
);
GO

-- ════════════════════════════════════════════════════════════════════════════
-- Coach ↔ Group assignments (many-to-many). group_id references
-- iStrata.dbo.is_groups(id) — a cross-database ref, so no FK (enforced in app,
-- same as other iStrata references). Managed on Admin > Coaches (Edit).
-- ════════════════════════════════════════════════════════════════════════════
IF OBJECT_ID('dbo.coach_groups','U') IS NULL
CREATE TABLE dbo.coach_groups (
  coach_id   INT NOT NULL,
  group_id   INT NOT NULL,
  created_at DATETIME2(3) DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_coach_groups PRIMARY KEY (coach_id, group_id)
);
GO

-- Booking captures which group the session was booked under (coach is assigned
-- to that group). Nullable; older sessions have none.
IF COL_LENGTH('dbo.coaching_sessions','group_id') IS NULL ALTER TABLE dbo.coaching_sessions ADD group_id INT NULL;
GO
