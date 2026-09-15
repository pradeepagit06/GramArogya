-- ============================================================================
-- GramArogya — Database Schema
-- Integrated Rural Healthcare Access & Quality Support Platform
-- Target: PostgreSQL 14+
-- ============================================================================
-- Notes:
--   * UUIDs are used as primary keys for easy client-side offline generation
--     (important for low-connectivity ASHA/patient flows).
--   * jsonb is used for flexible clinical fields (vitals, symptoms) so the
--     schema doesn't need migrations every time a new vital/field is added.
--   * Every clinically relevant table carries created_at/updated_at and,
--     where useful, a soft-delete flag rather than hard deletes.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- fuzzy name/phone search

-- ============================================================================
-- 1. ENUM TYPES
-- ============================================================================

CREATE TYPE user_role AS ENUM (
    'patient',
    'frontline_worker',   -- ASHA / ANM
    'doctor',
    'facility_staff',     -- PHC / hospital / pharmacy / lab staff
    'district_admin'
);

CREATE TYPE preferred_language AS ENUM ('en', 'hi', 'mr');

CREATE TYPE gender_type AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');

CREATE TYPE priority_level AS ENUM ('emergency', 'high', 'normal');

CREATE TYPE availability_status AS ENUM (
    'available', 'low_stock', 'out_of_stock',
    'limited', 'unavailable', 'temporarily_unavailable'
);

CREATE TYPE referral_status AS ENUM (
    'created', 'sent', 'received', 'accepted',
    'scheduled', 'patient_arrived', 'completed', 'cancelled'
);

CREATE TYPE appointment_status AS ENUM (
    'booked', 'confirmed', 'arrived', 'in_queue',
    'in_consultation', 'completed', 'cancelled', 'no_show'
);

CREATE TYPE consultation_mode AS ENUM ('in_person', 'teleconsultation');

CREATE TYPE consultation_status AS ENUM (
    'requested', 'queued', 'in_progress', 'completed', 'cancelled'
);

CREATE TYPE diagnostic_request_status AS ENUM (
    'requested', 'scheduled', 'sample_collected',
    'in_progress', 'completed', 'cancelled'
);

CREATE TYPE follow_up_status AS ENUM ('upcoming', 'due_today', 'overdue', 'completed', 'cancelled');

CREATE TYPE risk_category AS ENUM ('maternal', 'child', 'chronic', 'elderly', 'other');

CREATE TYPE facility_type AS ENUM ('sub_centre', 'phc', 'rural_hospital', 'district_hospital');

CREATE TYPE otp_purpose AS ENUM ('login', 'registration', 'password_reset', 'phone_verification');

CREATE TYPE sync_operation AS ENUM ('insert', 'update', 'delete');


-- ============================================================================
-- 2. AUTH & USERS
-- ============================================================================

-- Core identity/auth table shared by every role.
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role                user_role NOT NULL,
    full_name           VARCHAR(150) NOT NULL,
    phone_number        VARCHAR(15) UNIQUE,           -- primary login identifier (E.164-ish)
    email               VARCHAR(150) UNIQUE,
    password_hash       TEXT,                          -- NULL if OTP-only account
    preferred_language  preferred_language NOT NULL DEFAULT 'en',
    is_phone_verified   BOOLEAN NOT NULL DEFAULT FALSE,
    is_email_verified   BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    profile_photo_url   TEXT,
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_users_contact CHECK (phone_number IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX idx_users_phone ON users (phone_number);
CREATE INDEX idx_users_role ON users (role);

-- Role-specific professional details (doctor / frontline worker / facility staff / admin).
-- Kept separate from `users` so the core auth table stays lean.
CREATE TABLE staff_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    facility_id         UUID REFERENCES facilities(id),
    employee_id         VARCHAR(50),
    designation         VARCHAR(100),                  -- e.g. 'ASHA Worker', 'General Physician'
    specialization       VARCHAR(100),                  -- doctors only
    department          VARCHAR(100),
    license_number      VARCHAR(100),                   -- doctors: medical registration number
    jurisdiction_village VARCHAR(150),                   -- ASHA/ANM coverage area
    district             VARCHAR(100),
    is_on_duty          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- OTP-based auth (phone-first, standard for rural India).
CREATE TABLE otp_verifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number    VARCHAR(15) NOT NULL,
    otp_code_hash   TEXT NOT NULL,                      -- never store raw OTP
    purpose         otp_purpose NOT NULL,
    attempt_count   SMALLINT NOT NULL DEFAULT 0,
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_otp_phone ON otp_verifications (phone_number, purpose);

-- Active login sessions / refresh tokens (supports multi-device + revocation).
CREATE TABLE auth_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    device_info     VARCHAR(255),
    ip_address      INET,
    is_revoked      BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id);


-- ============================================================================
-- 3. FACILITIES
-- ============================================================================

CREATE TABLE facilities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(150) NOT NULL,
    type            facility_type NOT NULL,
    district        VARCHAR(100) NOT NULL,
    state           VARCHAR(100) NOT NULL,
    village_area    VARCHAR(150),
    address         TEXT,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    contact_phone   VARCHAR(15),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_facilities_district ON facilities (district, type);

-- (staff_profiles.facility_id above references this table — created after
--  since Postgres allows forward reference only via deferred FK; in practice
--  run this CREATE TABLE facilities block BEFORE staff_profiles, or add the
--  FK afterwards with ALTER TABLE. Shown here in logical/reading order.)


-- ============================================================================
-- 4. PATIENTS  (core of "every database to store patient details")
-- ============================================================================

-- Primary patient demographic + identity record.
CREATE TABLE patients (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL, -- NULL if registered by ASHA without app login
    patient_ref_code        VARCHAR(20) UNIQUE NOT NULL,     -- human-readable ID, e.g. GA-2026-000123
    full_name               VARCHAR(150) NOT NULL,
    date_of_birth           DATE,
    approximate_age         SMALLINT,                        -- used when DOB unknown
    gender                  gender_type NOT NULL,
    phone_number            VARCHAR(15),
    village                 VARCHAR(150),
    district                VARCHAR(100),
    state                   VARCHAR(100),
    address                 TEXT,
    emergency_contact_name  VARCHAR(150),
    emergency_contact_phone VARCHAR(15),
    emergency_contact_relation VARCHAR(50),
    blood_group             VARCHAR(5),
    registered_by_user_id   UUID REFERENCES users(id),        -- ASHA/ANM who registered the patient
    registered_at_facility  UUID REFERENCES facilities(id),
    preferred_language      preferred_language NOT NULL DEFAULT 'hi',
    photo_url                TEXT,
    is_active                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_patients_name_trgm ON patients USING gin (full_name gin_trgm_ops);
CREATE INDEX idx_patients_phone ON patients (phone_number);
CREATE INDEX idx_patients_ref_code ON patients (patient_ref_code);
CREATE INDEX idx_patients_village ON patients (village, district);

-- Clinical background: conditions, allergies, risk status.
-- Kept 1:1 with patients but separate so the core record stays light for search.
CREATE TABLE patient_health_profile (
    patient_id          UUID PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
    existing_conditions  JSONB NOT NULL DEFAULT '[]',   -- e.g. ["Diabetes", "Hypertension"]
    allergies            JSONB NOT NULL DEFAULT '[]',   -- e.g. ["Penicillin"]
    chronic_conditions   JSONB NOT NULL DEFAULT '[]',
    is_high_risk         BOOLEAN NOT NULL DEFAULT FALSE,
    risk_categories       risk_category[] DEFAULT '{}',
    current_risk_status  priority_level,                 -- latest known status, denormalized for fast dashboard cards
    notes                 TEXT,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Duplicate-detection support (per PRD: "duplicate patient warning").
CREATE TABLE patient_duplicate_flags (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    possible_duplicate_of UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    match_reason        VARCHAR(255),                    -- e.g. 'same phone + similar name'
    resolved            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================================
-- 5. DIGITAL TRIAGE
-- ============================================================================

CREATE TABLE triage_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    recorded_by     UUID REFERENCES users(id),           -- ASHA, doctor, or patient self-entry
    symptoms        JSONB NOT NULL DEFAULT '[]',         -- ["Fever", "Headache"]
    vitals          JSONB NOT NULL DEFAULT '{}',         -- {"temperature_c":38.2,"bp_systolic":140,"bp_diastolic":90,"heart_rate":98}
    duration_text   VARCHAR(100),
    severity_text   VARCHAR(50),
    priority_result priority_level NOT NULL,
    reason_summary  TEXT,                                -- e.g. "High BP, Fever, Increased heart rate"
    is_offline_entry BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_triage_patient ON triage_records (patient_id, created_at DESC);
CREATE INDEX idx_triage_priority ON triage_records (priority_result, created_at DESC);


-- ============================================================================
-- 6. APPOINTMENTS & QUEUE
-- ============================================================================

CREATE TABLE appointments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    facility_id         UUID NOT NULL REFERENCES facilities(id),
    doctor_id           UUID REFERENCES users(id),
    department          VARCHAR(100),
    priority             priority_level NOT NULL DEFAULT 'normal',
    status               appointment_status NOT NULL DEFAULT 'booked',
    scheduled_date       DATE NOT NULL,
    scheduled_time       TIME,
    queue_number          INTEGER,
    checked_in_at         TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_appointments_facility_date ON appointments (facility_id, scheduled_date, status);
CREATE INDEX idx_appointments_patient ON appointments (patient_id, scheduled_date DESC);


-- ============================================================================
-- 7. CONSULTATIONS (in-person + teleconsultation)
-- ============================================================================

CREATE TABLE consultations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id           UUID REFERENCES users(id),
    requested_by        UUID REFERENCES users(id),        -- ASHA who requested teleconsult, or patient
    facility_id         UUID REFERENCES facilities(id),
    appointment_id       UUID REFERENCES appointments(id),
    triage_record_id     UUID REFERENCES triage_records(id),
    mode                 consultation_mode NOT NULL DEFAULT 'in_person',
    status                consultation_status NOT NULL DEFAULT 'requested',
    symptoms             JSONB DEFAULT '[]',
    vitals                JSONB DEFAULT '{}',
    clinical_notes        TEXT,
    diagnosis              TEXT,
    treatment_instructions TEXT,
    video_room_url          TEXT,                          -- WebRTC session reference
    started_at               TIMESTAMPTZ,
    completed_at              TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_consultations_patient ON consultations (patient_id, created_at DESC);
CREATE INDEX idx_consultations_doctor_status ON consultations (doctor_id, status);


-- ============================================================================
-- 8. PRESCRIPTIONS
-- ============================================================================

CREATE TABLE prescriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id       UUID NOT NULL REFERENCES users(id),
    additional_advice TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_prescriptions_patient ON prescriptions (patient_id, created_at DESC);

CREATE TABLE prescription_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    medicine_name   VARCHAR(150) NOT NULL,
    dosage          VARCHAR(50),
    frequency       VARCHAR(50),
    duration        VARCHAR(50),
    instructions    TEXT
);


-- ============================================================================
-- 9. DIAGNOSTICS
-- ============================================================================

CREATE TABLE diagnostic_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    consultation_id UUID REFERENCES consultations(id),
    requested_by    UUID REFERENCES users(id),
    facility_id     UUID REFERENCES facilities(id),
    test_name       VARCHAR(150) NOT NULL,
    status          diagnostic_request_status NOT NULL DEFAULT 'requested',
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

CREATE TABLE diagnostic_reports (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diagnostic_request_id   UUID NOT NULL REFERENCES diagnostic_requests(id) ON DELETE CASCADE,
    result_summary          TEXT,
    report_file_url          TEXT,
    uploaded_by                UUID REFERENCES users(id),
    uploaded_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Facility-level availability (not per-patient, but essential operational data).
CREATE TABLE facility_diagnostic_availability (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id     UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    test_name       VARCHAR(150) NOT NULL,
    status          availability_status NOT NULL DEFAULT 'available',
    unavailable_reason TEXT,
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (facility_id, test_name)
);

CREATE TABLE facility_medicine_availability (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id     UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    medicine_name   VARCHAR(150) NOT NULL,
    status          availability_status NOT NULL DEFAULT 'available',
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (facility_id, medicine_name)
);


-- ============================================================================
-- 10. REFERRALS
-- ============================================================================

CREATE TABLE referrals (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id              UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    consultation_id          UUID REFERENCES consultations(id),
    referring_user_id         UUID REFERENCES users(id),       -- ASHA or doctor who created it
    referring_facility_id      UUID REFERENCES facilities(id),
    receiving_facility_id       UUID REFERENCES facilities(id),
    required_department          VARCHAR(100),
    reason                         TEXT NOT NULL,
    priority                       priority_level NOT NULL DEFAULT 'normal',
    status                          referral_status NOT NULL DEFAULT 'created',
    notes                           TEXT,
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_referrals_patient ON referrals (patient_id, created_at DESC);
CREATE INDEX idx_referrals_facility_status ON referrals (receiving_facility_id, status);

-- Full audit trail of every status change (feeds the district dashboard's
-- "delayed referral" alerts and the patient's referral-tracking timeline).
CREATE TABLE referral_status_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referral_id     UUID NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
    status          referral_status NOT NULL,
    changed_by      UUID REFERENCES users(id),
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    remarks         TEXT
);


-- ============================================================================
-- 11. FOLLOW-UPS
-- ============================================================================

CREATE TABLE follow_ups (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    related_consultation_id UUID REFERENCES consultations(id),
    related_referral_id  UUID REFERENCES referrals(id),
    assigned_to_user_id   UUID REFERENCES users(id),      -- ASHA/doctor responsible
    reason                 TEXT,
    risk_category            risk_category,
    follow_up_date             DATE NOT NULL,
    status                      follow_up_status NOT NULL DEFAULT 'upcoming',
    completed_at                 TIMESTAMPTZ,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_follow_ups_patient ON follow_ups (patient_id, follow_up_date);
CREATE INDEX idx_follow_ups_status_date ON follow_ups (status, follow_up_date);


-- ============================================================================
-- 12. NOTIFICATIONS
-- ============================================================================

CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(50) NOT NULL,      -- 'appointment_reminder','referral_update','follow_up_due', etc.
    title           VARCHAR(200) NOT NULL,
    message         TEXT NOT NULL,
    related_entity_type VARCHAR(50),           -- 'referral' | 'appointment' | 'follow_up' | 'prescription' ...
    related_entity_id   UUID,
    is_read          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id, is_read, created_at DESC);


-- ============================================================================
-- 13. AUDIT LOG
-- ============================================================================

CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id),
    action          VARCHAR(100) NOT NULL,      -- e.g. 'PATIENT_UPDATED', 'PRESCRIPTION_CREATED'
    entity_type     VARCHAR(50) NOT NULL,
    entity_id       UUID,
    ip_address      INET,
    details         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);


-- ============================================================================
-- 14. OFFLINE SYNC QUEUE  (low-connectivity support)
-- ============================================================================

-- Client (ASHA app / patient PWA) writes locally first, then pushes here on
-- reconnect. Server processes rows in order and reports back sync status.
CREATE TABLE offline_sync_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    entity_type     VARCHAR(50) NOT NULL,        -- 'patient' | 'triage_record' | 'follow_up' ...
    entity_local_id VARCHAR(100) NOT NULL,        -- client-generated UUID for offline dedup
    operation       sync_operation NOT NULL,
    payload         JSONB NOT NULL,
    is_synced       BOOLEAN NOT NULL DEFAULT FALSE,
    sync_error      TEXT,
    created_offline_at TIMESTAMPTZ NOT NULL,
    synced_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_queue_pending ON offline_sync_queue (user_id, is_synced);


-- ============================================================================
-- 15. HEALTH EDUCATION CONTENT (multilingual)
-- ============================================================================

CREATE TABLE health_education_content (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category        VARCHAR(100) NOT NULL,       -- 'maternal','child','nutrition','hygiene', etc.
    title_en        VARCHAR(255),
    title_hi        VARCHAR(255),
    title_mr        VARCHAR(255),
    body_en         TEXT,
    body_hi         TEXT,
    body_mr         TEXT,
    audio_url_en    TEXT,
    audio_url_hi    TEXT,
    audio_url_mr    TEXT,
    media_url       TEXT,
    is_published    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================================
-- 16. USEFUL VIEWS (examples — build out as dashboards need them)
-- ============================================================================

-- Fast lookup for the patient home screen "next appointment / active referral
-- / follow-up due" cards without hitting five tables from the client.
CREATE VIEW v_patient_dashboard_summary AS
SELECT
    p.id AS patient_id,
    p.full_name,
    (SELECT row_to_json(a) FROM (
        SELECT id, facility_id, doctor_id, scheduled_date, scheduled_time, queue_number, status
        FROM appointments
        WHERE patient_id = p.id AND status IN ('booked','confirmed')
        ORDER BY scheduled_date, scheduled_time LIMIT 1
    ) a) AS next_appointment,
    (SELECT row_to_json(r) FROM (
        SELECT id, status, receiving_facility_id, priority, updated_at
        FROM referrals
        WHERE patient_id = p.id AND status NOT IN ('completed','cancelled')
        ORDER BY updated_at DESC LIMIT 1
    ) r) AS active_referral,
    (SELECT row_to_json(f) FROM (
        SELECT id, follow_up_date, reason, status
        FROM follow_ups
        WHERE patient_id = p.id AND status IN ('upcoming','due_today','overdue')
        ORDER BY follow_up_date LIMIT 1
    ) f) AS next_follow_up
FROM patients p;


-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
