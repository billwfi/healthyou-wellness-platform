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
  duration_minutes  INT DEFAULT 60,
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

-- ── Business Hours (multiple rows per day = "Split") ──────────────────────────
IF OBJECT_ID('dbo.event_business_hours','U') IS NULL
CREATE TABLE dbo.event_business_hours (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  event_id    INT NOT NULL,
  day_of_week INT NOT NULL,          -- 0=Sun … 6=Sat
  is_open     BIT DEFAULT 0,
  from_time   TIME,
  to_time     TIME,
  sort_order  INT DEFAULT 0
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_event_hours_event') CREATE INDEX idx_event_hours_event ON dbo.event_business_hours(event_id);
GO

-- ── Availability slots (per time-slot capacity grid) ──────────────────────────
IF OBJECT_ID('dbo.event_availability_slots','U') IS NULL
CREATE TABLE dbo.event_availability_slots (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  event_id    INT NOT NULL,
  day_of_week INT NOT NULL,
  start_time  TIME NOT NULL,
  capacity    INT DEFAULT 1
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_event_slots_event') CREATE INDEX idx_event_slots_event ON dbo.event_availability_slots(event_id);
GO

-- ── Service locations (link to org_locations) ─────────────────────────────────
IF OBJECT_ID('dbo.event_service_locations','U') IS NULL
CREATE TABLE dbo.event_service_locations (
  event_id    INT NOT NULL,
  location_id INT NOT NULL,
  CONSTRAINT pk_event_service_locations PRIMARY KEY (event_id, location_id)
);
GO

-- ── Notification recipients (staff) ───────────────────────────────────────────
IF OBJECT_ID('dbo.event_notification_recipients','U') IS NULL
CREATE TABLE dbo.event_notification_recipients (
  id       INT IDENTITY(1,1) PRIMARY KEY,
  event_id INT NOT NULL,
  name     NVARCHAR(255),
  email    NVARCHAR(255)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_event_notif_event') CREATE INDEX idx_event_notif_event ON dbo.event_notification_recipients(event_id);
GO
