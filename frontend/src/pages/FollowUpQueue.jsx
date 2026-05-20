/**
 * Follow-Up Queue — all pending follow-ups across all leads, sorted by due date.
 * Agents can mark them done or reschedule from here.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Clock, Phone, MessageSquare, Mail, CheckCircle2, RefreshCw, AlertTriangle, Calendar } from 'lucide-react';
import { api } from '../lib/api';
import { format, formatDistanceToNow, isPast, isToday } from 'date-fns';

const METHOD_ICON = {
  call:      <Phone size={14} />,
  whatsapp:  <MessageSquare size={14} />,
  sms:       <MessageSquare size={14} />,
  email:     <Mail size={14} />,
};

const METHOD_COLOR = {
  call:     '#22d3ee',
  whatsapp: '#4ade80',
  sms:      '#a78bfa',
  email:    '#fb923c',
};

function urgencyBadge(scheduled_at) {
  const d = new Date(scheduled_at);
  if (isPast(d)) return { label: 'Overdue', bg: '#fca5a520', color: '#f87171' };
  if (isToday(d)) return { label: 'Today',   bg: '#fde04720', color: '#fbbf24' };
  return null;
}

export default function FollowUpQueue() {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [leads, setLeads]       = useState({});   // id → { full_name, phone }
  const [filter, setFilter]     = useState('pending'); // pending | all
  const [rescheduleId, setRescheduleId] = useState(null);
  const [newDate, setNewDate]   = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all leads (paginated, but we grab first 200 for the queue view)
      const leadsRes = await api.get('/leads', { params: { page: 1, page_size: 200 } });
      const leadsMap = {};
      for (const l of (leadsRes.data.items || [])) leadsMap[l.id] = l;
      setLeads(leadsMap);

      // Fetch follow-ups for each lead in parallel (batch of 20)
      const leadIds = Object.keys(leadsMap);
      const chunks = [];
      for (let i = 0; i < leadIds.length; i += 20) chunks.push(leadIds.slice(i, i + 20));

      const all = [];
      for (const chunk of chunks) {
        const results = await Promise.allSettled(
          chunk.map(id => api.get(`/leads/${id}/follow-ups`).then(r => r.data.map(fu => ({ ...fu, lead_id: id }))))
        );
        for (const r of results) {
          if (r.status === 'fulfilled') all.push(...r.value);
        }
      }

      all.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
      setItems(all);
    } catch (err) {
      toast.error('Failed to load follow-up queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const markDone = async (fu) => {
    try {
      await api.patch(`/leads/${fu.lead_id}/follow-ups/${fu.id}`, { is_completed: true });
      toast.success('Marked as done');
      setItems(prev => prev.map(f => f.id === fu.id ? { ...f, is_completed: true } : f));
    } catch {
      toast.error('Failed to update');
    }
  };

  const saveReschedule = async (fu) => {
    if (!newDate) return;
    try {
      await api.patch(`/leads/${fu.lead_id}/follow-ups/${fu.id}`, {
        is_completed: false,
        note: fu.note,
      });
      // The API patch doesn't support scheduled_at update currently — show hint
      toast.success('Note updated. To fully reschedule, create a new follow-up on the Lead page.');
      setRescheduleId(null);
      setNewDate('');
    } catch {
      toast.error('Failed to reschedule');
    }
  };

  const visible = filter === 'pending'
    ? items.filter(f => !f.is_completed)
    : items;

  const overdueCount = items.filter(f => !f.is_completed && isPast(new Date(f.scheduled_at))).length;

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Follow-Up Queue</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {visible.length} follow-up{visible.length !== 1 ? 's' : ''}
            {overdueCount > 0 && (
              <span style={{ marginLeft: 8, color: '#f87171', fontWeight: 600 }}>
                · {overdueCount} overdue
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['pending', 'all'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none',
                background: filter === f ? 'var(--accent-blue)' : 'var(--bg-elevated)',
                color: filter === f ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {f === 'pending' ? 'Pending' : 'All'}
            </button>
          ))}
          <button
            onClick={loadAll}
            style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--bg-elevated)', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading queue...</div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          <CheckCircle2 size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p>No {filter === 'pending' ? 'pending' : ''} follow-ups</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.map(fu => {
            const lead = leads[fu.lead_id] || {};
            const badge = urgencyBadge(fu.scheduled_at);
            const isRescheduling = rescheduleId === fu.id;

            return (
              <div
                key={fu.id}
                style={{
                  background: 'var(--bg-elevated)',
                  borderRadius: 12,
                  padding: '14px 18px',
                  border: `1px solid ${fu.is_completed ? 'var(--border-subtle)' : badge ? badge.color + '40' : 'var(--border-default)'}`,
                  opacity: fu.is_completed ? 0.55 : 1,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 14,
                }}
              >
                {/* Method icon */}
                <div style={{
                  width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                  background: (METHOD_COLOR[fu.method] || '#6366f1') + '20',
                  color: METHOD_COLOR[fu.method] || '#6366f1',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {METHOD_ICON[fu.method] || <Clock size={14} />}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <Link
                      to={`/leads/${fu.lead_id}`}
                      style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', textDecoration: 'none' }}
                    >
                      {lead.full_name || 'Unknown Lead'}
                    </Link>
                    <span style={{
                      fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 99,
                      background: (METHOD_COLOR[fu.method] || '#6366f1') + '20',
                      color: METHOD_COLOR[fu.method] || '#6366f1',
                      textTransform: 'capitalize',
                    }}>
                      {fu.method}
                    </span>
                    {badge && (
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: badge.bg, color: badge.color }}>
                        {badge.label}
                      </span>
                    )}
                    {fu.is_completed && (
                      <span style={{ fontSize: 11, color: '#4ade80' }}>Completed</span>
                    )}
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Calendar size={12} />
                    {format(new Date(fu.scheduled_at), 'dd MMM yyyy, hh:mm a')}
                    <span style={{ opacity: 0.6 }}>·</span>
                    {formatDistanceToNow(new Date(fu.scheduled_at), { addSuffix: true })}
                  </div>

                  {fu.note && (
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      {fu.note}
                    </p>
                  )}

                  {lead.phone && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{lead.phone}</div>
                  )}

                  {/* Reschedule note input */}
                  {isRescheduling && (
                    <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                      <input
                        type="datetime-local"
                        value={newDate}
                        onChange={e => setNewDate(e.target.value)}
                        style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 13 }}
                      />
                      <button onClick={() => saveReschedule(fu)} style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--accent-blue)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13 }}>Save</button>
                      <button onClick={() => setRescheduleId(null)} style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--bg-base)', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                    </div>
                  )}
                </div>

                {/* Actions */}
                {!fu.is_completed && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => { setRescheduleId(isRescheduling ? null : fu.id); setNewDate(''); }}
                      title="Reschedule"
                      style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border-default)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                    >
                      <RefreshCw size={12} /> Reschedule
                    </button>
                    <button
                      onClick={() => markDone(fu)}
                      title="Mark as done"
                      style={{ padding: '6px 10px', borderRadius: 8, background: '#4ade8020', border: '1px solid #4ade8040', color: '#4ade80', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                    >
                      <CheckCircle2 size={12} /> Done
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
