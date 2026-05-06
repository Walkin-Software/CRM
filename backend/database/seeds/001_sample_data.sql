-- =============================================================
-- Sample Seed Data for Testing
-- =============================================================

-- Insert sample users
INSERT INTO users (id, email, password_hash, full_name, role_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@phoneagent.ai', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TgxFphhMmJ3bPYkJEYEA4NjBgIPq', 'Admin User',
    (SELECT id FROM roles WHERE name = 'admin')),
  ('22222222-2222-2222-2222-222222222222', 'agent1@phoneagent.ai', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TgxFphhMmJ3bPYkJEYEA4NjBgIPq', 'Priya Sharma',
    (SELECT id FROM roles WHERE name = 'agent')),
  ('33333333-3333-3333-3333-333333333333', 'agent2@phoneagent.ai', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TgxFphhMmJ3bPYkJEYEA4NjBgIPq', 'Rahul Verma',
    (SELECT id FROM roles WHERE name = 'agent'));
-- Default password for all seed users: "Password123!"

-- Insert sample leads
INSERT INTO leads (full_name, phone, email, interest, source, status, assigned_to) VALUES
  ('Arjun Mehta',    '+919876543210', 'arjun@example.com',   'Full Stack Development Course', 'inbound_call', 'contacted',       '22222222-2222-2222-2222-222222222222'),
  ('Sneha Patel',    '+919876543211', 'sneha@example.com',   'Data Science Bootcamp',         'web_form',     'demo_scheduled',  '22222222-2222-2222-2222-222222222222'),
  ('Kiran Kumar',    '+919876543212', 'kiran@example.com',   'DevOps & Cloud Training',       'inbound_call', 'new',             '33333333-3333-3333-3333-333333333333'),
  ('Meena Reddy',    '+919876543213', 'meena@example.com',   'Full Stack Development Course', 'outbound_call','qualified',       '33333333-3333-3333-3333-333333333333'),
  ('Aditya Singh',   '+919876543214', 'aditya@example.com',  'Placement Program',             'whatsapp',     'converted',       '22222222-2222-2222-2222-222222222222'),
  ('Pooja Nair',     '+919876543215', 'pooja@example.com',   'Pricing inquiry',               'sms',          'lost',            NULL),
  ('Vikram Das',     '+919876543216', 'vikram@example.com',  'Data Science Bootcamp',         'referral',     'new',             NULL),
  ('Ananya Joshi',   '+919876543217', 'ananya@example.com',  'Full Stack Development Course', 'inbound_call', 'contacted',       '33333333-3333-3333-3333-333333333333');

-- Insert sample calls
INSERT INTO calls (twilio_call_sid, direction, status, from_number, to_number, duration_seconds, started_at, ended_at, handled_by,
  lead_id)
SELECT
  'CA' || substr(md5(random()::text), 1, 32),
  'inbound',
  'completed',
  '+919876543210',
  '+12025550100',
  floor(random() * 300 + 60)::int,
  NOW() - interval '2 hours',
  NOW() - interval '1 hour 55 minutes',
  'ai',
  id
FROM leads WHERE phone = '+919876543210'
LIMIT 1;

-- Insert sample time slots (next 5 business days)
INSERT INTO time_slots (agent_id, starts_at, ends_at) VALUES
  ('22222222-2222-2222-2222-222222222222', NOW() + interval '1 day 10 hours', NOW() + interval '1 day 10 hours 30 minutes'),
  ('22222222-2222-2222-2222-222222222222', NOW() + interval '1 day 11 hours', NOW() + interval '1 day 11 hours 30 minutes'),
  ('22222222-2222-2222-2222-222222222222', NOW() + interval '1 day 14 hours', NOW() + interval '1 day 14 hours 30 minutes'),
  ('33333333-3333-3333-3333-333333333333', NOW() + interval '2 days 10 hours', NOW() + interval '2 days 10 hours 30 minutes'),
  ('33333333-3333-3333-3333-333333333333', NOW() + interval '2 days 15 hours', NOW() + interval '2 days 15 hours 30 minutes');
