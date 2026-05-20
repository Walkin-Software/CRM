/**
 * Public Lead Intake Form — no auth required.
 * Accessible at /intake — the first touchpoint for web form leads.
 * Submits to POST /api/leads/public.
 */

import { useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { CheckCircle2, Send, User, Phone, Mail, Briefcase, FileText } from 'lucide-react';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const INTEREST_OPTIONS = [
  'Software Development Training',
  'Data Science & AI Course',
  'Full Stack Development',
  'Job Placement Assistance',
  'Career Counselling',
  'Other',
];

const SOURCE_OPTIONS = [
  { value: 'web_form',       label: 'Website' },
  { value: 'social_media',   label: 'Social Media' },
  { value: 'referral',       label: 'Referral' },
  { value: 'manual',         label: 'Other' },
];

export default function PublicIntakeForm() {
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', interest: '',
    job_role: '', years_experience: '', description: '', source: 'web_form',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [errors, setErrors]         = useState({});

  const update = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    if (errors[k]) setErrors(p => { const n = { ...p }; delete n[k]; return n; });
  };

  const validate = () => {
    const e = {};
    if (!form.full_name.trim()) e.full_name = 'Name is required';
    if (!form.phone.trim())     e.phone     = 'Phone number is required';
    if (form.phone.trim() && !/^[+\d\s\-()]{7,15}$/.test(form.phone.trim())) e.phone = 'Enter a valid phone number';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email';
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSubmitting(true);
    try {
      const payload = {
        full_name:        form.full_name.trim(),
        phone:            form.phone.trim(),
        email:            form.email.trim() || undefined,
        interest:         form.interest || undefined,
        job_role:         form.job_role.trim() || undefined,
        years_experience: form.years_experience ? parseFloat(form.years_experience) : undefined,
        description:      form.description.trim() || undefined,
        source:           form.source,
      };
      await axios.post(`${BASE_URL}/leads/public`, payload, {
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      });
      setSubmitted(true);
    } catch (err) {
      const msg = err.response?.data?.detail || 'Submission failed. Please try again.';
      toast.error(typeof msg === 'string' ? msg : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', padding: 20 }}>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#4ade8020', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', border: '2px solid #4ade8040' }}>
            <CheckCircle2 size={36} color="#4ade80" />
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 12px' }}>
            You're on the list!
          </h2>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 24px' }}>
            Thank you for your interest. Our team will reach out to you shortly on
            <strong> {form.phone}</strong>{form.email ? ` and ${form.email}` : ''}.
          </p>
          <button
            onClick={() => { setSubmitted(false); setForm({ full_name:'', phone:'', email:'', interest:'', job_role:'', years_experience:'', description:'', source:'web_form' }); }}
            style={{ padding: '10px 24px', borderRadius: 10, background: 'var(--accent-blue)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 600 }}
          >
            Submit Another
          </button>
        </div>
      </div>
    );
  }

  const Field = ({ icon: Icon, label, error, children }) => (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        {Icon && <Icon size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />}
        {children}
      </div>
      {error && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#f87171' }}>{error}</p>}
    </div>
  );

  const inputStyle = (hasIcon, hasError) => ({
    width: '100%', padding: hasIcon ? '10px 12px 10px 36px' : '10px 12px',
    borderRadius: 10, border: `1px solid ${hasError ? '#f8717160' : 'var(--border-default)'}`,
    background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 14,
    outline: 'none', boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', padding: '40px 20px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--gradient-brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 28 }}>
            🤖
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
            Get Started
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            Fill in your details and our team will contact you for a free consultation.
          </p>
        </div>

        {/* Card */}
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 16, border: '1px solid var(--border-default)', padding: '28px 28px 24px' }}>
          <form onSubmit={handleSubmit} noValidate>
            <Field icon={User} label="Full Name *" error={errors.full_name}>
              <input
                value={form.full_name}
                onChange={e => update('full_name', e.target.value)}
                placeholder="Your full name"
                style={inputStyle(true, !!errors.full_name)}
              />
            </Field>

            <Field icon={Phone} label="Phone Number *" error={errors.phone}>
              <input
                value={form.phone}
                onChange={e => update('phone', e.target.value)}
                placeholder="+91 98765 43210"
                type="tel"
                style={inputStyle(true, !!errors.phone)}
              />
            </Field>

            <Field icon={Mail} label="Email Address" error={errors.email}>
              <input
                value={form.email}
                onChange={e => update('email', e.target.value)}
                placeholder="you@email.com (optional)"
                type="email"
                style={inputStyle(true, !!errors.email)}
              />
            </Field>

            <Field label="I'm interested in">
              <select
                value={form.interest}
                onChange={e => update('interest', e.target.value)}
                style={{ ...inputStyle(false, false), appearance: 'none', cursor: 'pointer' }}
              >
                <option value="">Select an option...</option>
                {INTEREST_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field icon={Briefcase} label="Current Role / Job Title">
                <input
                  value={form.job_role}
                  onChange={e => update('job_role', e.target.value)}
                  placeholder="e.g. Software Engineer"
                  style={inputStyle(true, false)}
                />
              </Field>
              <Field label="Years of Experience">
                <input
                  value={form.years_experience}
                  onChange={e => update('years_experience', e.target.value)}
                  placeholder="e.g. 2"
                  type="number"
                  min="0"
                  max="50"
                  style={inputStyle(false, false)}
                />
              </Field>
            </div>

            <Field label="How did you hear about us?">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {SOURCE_OPTIONS.map(s => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => update('source', s.value)}
                    style={{
                      padding: '6px 14px', borderRadius: 99, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      border: `1px solid ${form.source === s.value ? 'var(--accent-blue)' : 'var(--border-default)'}`,
                      background: form.source === s.value ? 'var(--accent-blue)20' : 'transparent',
                      color: form.source === s.value ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field icon={FileText} label="Tell us about yourself">
              <textarea
                value={form.description}
                onChange={e => update('description', e.target.value)}
                placeholder="Briefly describe your background or what you're looking for..."
                rows={3}
                style={{
                  ...inputStyle(false, false),
                  resize: 'vertical', minHeight: 80, fontFamily: 'inherit', lineHeight: 1.5,
                  padding: '10px 12px',
                }}
              />
            </Field>

            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%', padding: '13px', borderRadius: 12, border: 'none',
                background: submitting ? 'var(--bg-base)' : 'var(--accent-blue)',
                color: '#fff', fontSize: 15, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background 0.2s',
              }}
            >
              {submitting ? 'Submitting...' : <><Send size={16} /> Submit — Get a Free Consultation</>}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 16 }}>
          Your information is safe and will not be shared with third parties.
        </p>
      </div>
    </div>
  );
}
