-- =============================================================
-- AI Phone Agent System — MySQL Schema
-- Version: 1.0.0
-- DB: MySQL 8.x  |  User: root  |  Password: radhe123
-- =============================================================

CREATE DATABASE IF NOT EXISTS ai_phone_agent
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ai_phone_agent;

-- =============================================================
-- ROLES & USERS (Auth / RBAC)
-- =============================================================

CREATE TABLE roles (
  id         CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  name       VARCHAR(50)  UNIQUE NOT NULL COMMENT "'admin','agent','viewer'",
  permissions JSON        NOT NULL DEFAULT ('[]'),
  created_at DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE TABLE users (
  id            CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  role_id       CHAR(36)     REFERENCES roles(id) ON DELETE SET NULL,
  is_active     TINYINT(1)   DEFAULT 1,
  last_login_at DATETIME(3),
  created_at    DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_users_email (email),
  INDEX idx_users_role  (role_id)
);

CREATE TABLE refresh_tokens (
  id         CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  user_id    CHAR(36)     NOT NULL,
  token      TEXT         NOT NULL,
  expires_at DATETIME(3)  NOT NULL,
  created_at DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_rt_user (user_id)
);

-- =============================================================
-- LEADS & CRM
-- =============================================================

CREATE TABLE leads (
  id          CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  full_name   VARCHAR(255) NOT NULL,
  phone       VARCHAR(20)  NOT NULL,
  email       VARCHAR(255),
  interest    TEXT         COMMENT 'Course/service the lead is interested in',
  source      ENUM('inbound_call','outbound_call','web_form','whatsapp','sms','referral','social_media','manual')
              DEFAULT 'manual',
  status      ENUM('new','contacted','qualified','demo_scheduled','proposal_sent','converted','lost','unresponsive')
              DEFAULT 'new',
  assigned_to CHAR(36),
  tags        JSON         DEFAULT ('[]'),
  metadata    JSON         DEFAULT ('{}'),
  created_at  DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_leads_phone      (phone),
  INDEX idx_leads_status     (status),
  INDEX idx_leads_assigned   (assigned_to),
  FULLTEXT  idx_leads_search (full_name, email, interest)
);

CREATE TABLE lead_notes (
  id         CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  lead_id    CHAR(36)    NOT NULL,
  author_id  CHAR(36),
  content    TEXT        NOT NULL,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (lead_id)   REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE lead_follow_ups (
  id           CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  lead_id      CHAR(36)    NOT NULL,
  scheduled_at DATETIME(3) NOT NULL,
  method       VARCHAR(50) NOT NULL COMMENT 'call, whatsapp, sms, email',
  note         TEXT,
  is_completed TINYINT(1)  DEFAULT 0,
  completed_at DATETIME(3),
  created_by   CHAR(36),
  created_at   DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (lead_id)    REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_followups_lead         (lead_id),
  INDEX idx_followups_scheduled_at (scheduled_at)
);

-- =============================================================
-- CALLS
-- =============================================================

CREATE TABLE calls (
  id                CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  twilio_call_sid   VARCHAR(64) UNIQUE,
  lead_id           CHAR(36),
  direction         ENUM('inbound','outbound') NOT NULL,
  status            ENUM('initiated','ringing','in_progress','completed','failed','no_answer','busy','transferred')
                    DEFAULT 'initiated',
  from_number       VARCHAR(20) NOT NULL,
  to_number         VARCHAR(20) NOT NULL,
  duration_seconds  INT         DEFAULT 0,
  recording_url     TEXT,
  recording_sid     VARCHAR(64),
  started_at        DATETIME(3),
  ended_at          DATETIME(3),
  handled_by        VARCHAR(20) DEFAULT 'ai'  COMMENT 'ai or human',
  transferred_to    VARCHAR(20),
  metadata          JSON        DEFAULT ('{}'),
  created_at        DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  INDEX idx_calls_lead_id    (lead_id),
  INDEX idx_calls_twilio_sid (twilio_call_sid),
  INDEX idx_calls_created_at (created_at DESC)
);

-- =============================================================
-- AI CONVERSATIONS
-- =============================================================

CREATE TABLE conversations (
  id             CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  call_id        CHAR(36),
  lead_id        CHAR(36),
  session_id     VARCHAR(128) UNIQUE NOT NULL,
  summary        TEXT,
  primary_intent ENUM('greeting','course_inquiry','pricing_inquiry','placement_inquiry',
                      'schedule_demo','complaint','payment_query','human_escalation',
                      'goodbye','unknown') DEFAULT 'unknown',
  sentiment      VARCHAR(20)  COMMENT 'positive, neutral, negative',
  created_at     DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3),
  ended_at       DATETIME(3),
  FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
);

CREATE TABLE conversation_messages (
  id              CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  conversation_id CHAR(36)    NOT NULL,
  role            ENUM('system','user','assistant','function') NOT NULL,
  content         TEXT        NOT NULL,
  intent          ENUM('greeting','course_inquiry','pricing_inquiry','placement_inquiry',
                       'schedule_demo','complaint','payment_query','human_escalation',
                       'goodbye','unknown'),
  confidence      FLOAT       COMMENT 'Intent confidence score 0-1',
  latency_ms      INT         COMMENT 'Time to generate this response',
  tokens_used     INT,
  created_at      DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  INDEX idx_messages_conversation (conversation_id)
);

-- =============================================================
-- SCHEDULING
-- =============================================================

CREATE TABLE time_slots (
  id           CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  agent_id     CHAR(36),
  starts_at    DATETIME(3) NOT NULL,
  ends_at      DATETIME(3) NOT NULL,
  is_available TINYINT(1)  DEFAULT 1,
  created_at   DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_slots_agent      (agent_id),
  INDEX idx_slots_starts_at  (starts_at),
  INDEX idx_slots_available  (is_available)
);

CREATE TABLE bookings (
  id                CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  slot_id           CHAR(36)    NOT NULL,
  lead_id           CHAR(36)    NOT NULL,
  booked_by         CHAR(36),
  status            ENUM('pending','confirmed','cancelled','completed','no_show') DEFAULT 'pending',
  meeting_link      TEXT,
  confirmation_code VARCHAR(16) UNIQUE,
  notes             TEXT,
  reminder_sent     TINYINT(1)  DEFAULT 0,
  cancelled_at      DATETIME(3),
  cancelled_reason  TEXT,
  created_at        DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (slot_id)   REFERENCES time_slots(id) ON DELETE RESTRICT,
  FOREIGN KEY (lead_id)   REFERENCES leads(id)      ON DELETE CASCADE,
  FOREIGN KEY (booked_by) REFERENCES users(id)      ON DELETE SET NULL,
  INDEX idx_bookings_lead_id (lead_id),
  INDEX idx_bookings_slot_id (slot_id),
  INDEX idx_bookings_status  (status)
);

-- =============================================================
-- NOTIFICATIONS
-- =============================================================

CREATE TABLE notifications (
  id              CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  lead_id         CHAR(36),
  channel         ENUM('sms','whatsapp','email','push') NOT NULL,
  template_name   VARCHAR(100),
  recipient_phone VARCHAR(20),
  recipient_email VARCHAR(255),
  content         TEXT        NOT NULL,
  status          ENUM('pending','sent','delivered','failed','read') DEFAULT 'pending',
  external_sid    VARCHAR(128) COMMENT 'Twilio Message SID',
  error_message   TEXT,
  scheduled_at    DATETIME(3),
  sent_at         DATETIME(3),
  delivered_at    DATETIME(3),
  created_at      DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  INDEX idx_notifications_lead   (lead_id),
  INDEX idx_notifications_status (status)
);

-- =============================================================
-- PAYMENTS
-- =============================================================

CREATE TABLE transactions (
  id                        CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  lead_id                   CHAR(36),
  stripe_payment_intent_id  VARCHAR(128) UNIQUE,
  stripe_session_id         VARCHAR(128),
  amount_cents              INT         NOT NULL COMMENT 'Amount in smallest currency unit (paise for INR)',
  currency                  VARCHAR(3)  DEFAULT 'INR',
  status                    ENUM('pending','completed','failed','refunded','partially_refunded') DEFAULT 'pending',
  description               TEXT,
  payment_method            VARCHAR(50) COMMENT 'card, upi, netbanking',
  metadata                  JSON        DEFAULT ('{}'),
  refund_amount_cents        INT         DEFAULT 0,
  refunded_at               DATETIME(3),
  completed_at              DATETIME(3),
  failed_at                 DATETIME(3),
  created_at                DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  INDEX idx_transactions_lead   (lead_id),
  INDEX idx_transactions_stripe (stripe_payment_intent_id)
);

-- =============================================================
-- AUDIT LOG
-- =============================================================

CREATE TABLE audit_logs (
  id          BIGINT      AUTO_INCREMENT PRIMARY KEY,
  user_id     CHAR(36),
  action      VARCHAR(100) NOT NULL COMMENT 'e.g. lead.update, call.transfer',
  entity_type VARCHAR(50),
  entity_id   CHAR(36),
  old_value   JSON,
  new_value   JSON,
  ip_address  VARCHAR(45),
  created_at  DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_user    (user_id),
  INDEX idx_audit_entity  (entity_type, entity_id),
  INDEX idx_audit_created (created_at DESC)
);

-- =============================================================
-- DEFAULT ROLES SEED
-- =============================================================

INSERT INTO roles (id, name, permissions) VALUES
  (UUID(), 'admin',  JSON_ARRAY('leads:*','calls:*','users:*','analytics:*','settings:*')),
  (UUID(), 'agent',  JSON_ARRAY('leads:read','leads:update','calls:read','calls:create','analytics:read')),
  (UUID(), 'viewer', JSON_ARRAY('leads:read','calls:read','analytics:read'));
