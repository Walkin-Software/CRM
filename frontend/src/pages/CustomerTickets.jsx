import { useState, useEffect, useCallback } from 'react';
import { Ticket, Plus, Clock, Search, HelpCircle, AlertCircle, FileText, CheckCircle2, User, ChevronRight, MessageSquare, AlertTriangle, RefreshCw, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { ticketsAPI } from '../lib/api';

const PRIORITY_META = {
  High:   { color: '#ef4444', bg: 'rgba(239,68,68,0.08)' },
  Medium: { color: '#f97316', bg: 'rgba(249,115,22,0.08)' },
  Low:    { color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
};
const STATUS_META = {
  Open:        { color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  'In Progress':{ color: '#f97316', bg: 'rgba(249,115,22,0.08)' },
  Resolved:    { color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  Closed:      { color: '#64748b', bg: 'rgba(100,116,139,0.08)' },
};

export default function CustomerTickets() {
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('detail');
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // New ticket form state
  const [subject, setSubject] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [descText, setDescText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedTicket = tickets.find(t => t.id === selectedTicketId) || tickets[0] || null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        ticketsAPI.list({ search: searchQuery || undefined }),
        ticketsAPI.stats(),
      ]);
      const items = listRes.data?.items || [];
      setTickets(items);
      setStats(statsRes.data);
      if (items.length && !selectedTicketId) setSelectedTicketId(items[0].id);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load tickets.');
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => { load(); }, [load]);

  const handleAddTicket = async (e) => {
    e.preventDefault();
    if (!subject.trim() || !customerName.trim()) {
      toast.error('Subject and customer name are required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await ticketsAPI.create({
        subject: subject.trim(),
        customer_name: customerName.trim(),
        customer_email: customerEmail.trim() || undefined,
        priority,
        description: descText.trim() || undefined,
      });
      const created = res.data;
      setTickets(prev => [created, ...prev]);
      setSelectedTicketId(created.id);
      setSubject(''); setCustomerName(''); setCustomerEmail(''); setDescText('');
      setActiveTab('detail');
      toast.success('Support ticket created!');
      // Reload stats
      ticketsAPI.stats().then(r => setStats(r.data)).catch(() => {});
    } catch {
      toast.error('Failed to create ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (ticket) => {
    try {
      const res = await ticketsAPI.update(ticket.id, { status: 'Resolved' });
      setTickets(prev => prev.map(t => t.id === ticket.id ? res.data : t));
      toast.success('Ticket resolved!');
      ticketsAPI.stats().then(r => setStats(r.data)).catch(() => {});
    } catch {
      toast.error('Failed to resolve ticket.');
    }
  };

  const handleClose = async (ticket) => {
    try {
      const res = await ticketsAPI.update(ticket.id, { status: 'Closed' });
      setTickets(prev => prev.map(t => t.id === ticket.id ? res.data : t));
      toast.success('Ticket closed.');
    } catch {
      toast.error('Failed to close ticket.');
    }
  };

  const handleDelete = async (ticket) => {
    if (!window.confirm(`Delete ticket ${ticket.ticket_number || ticket.id}?`)) return;
    try {
      await ticketsAPI.delete(ticket.id);
      setTickets(prev => prev.filter(t => t.id !== ticket.id));
      if (selectedTicketId === ticket.id) setSelectedTicketId(null);
      toast.success('Ticket deleted.');
      ticketsAPI.stats().then(r => setStats(r.data)).catch(() => {});
    } catch {
      toast.error('Failed to delete ticket.');
    }
  };

  return (
    <div className="flex-col gap-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Support Tickets</h2>
          <p className="page-subtitle">Track priority levels, sort logs, resolve customer queries, and evaluate SLA response metrics.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setActiveTab('new')}>
            <Plus size={13} /> New Ticket
          </button>
          <button className="btn btn-secondary btn-sm" onClick={load}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* SLA Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Active Tickets</span>
              <span className="kpi-value">{loading ? 'â€¦' : (stats?.active ?? 'â€”')}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(37,99,235,0.08)', color: '#2563eb' }}>
              <Ticket size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--text-4)' }}>Open + In Progress</span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">SLA Breached</span>
              <span className="kpi-value" style={{ color: stats?.sla_breached > 0 ? '#ef4444' : undefined }}>
                {loading ? 'â€¦' : (stats?.sla_breached ?? 'â€”')}
              </span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
              <AlertTriangle size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: stats?.sla_breached > 0 ? '#ef4444' : '#16a34a' }}>
            {stats?.sla_breached > 0 ? 'Needs immediate attention' : 'All tickets on time'}
          </span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">SLA Compliance</span>
              <span className="kpi-value">{loading ? 'â€¦' : `${stats?.sla_met_rate ?? 0}%`}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(16,185,129,0.08)', color: '#10b981' }}>
              <CheckCircle2 size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: '#16a34a' }}>Response metric</span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Resolved Tickets</span>
              <span className="kpi-value">{loading ? 'â€¦' : (stats?.resolved ?? 'â€”')}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(249,115,22,0.08)', color: '#f97316' }}>
              <FileText size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--text-4)' }}>Total closed: {stats?.total ?? 'â€”'}</span>
        </div>
      </div>

      {/* Main split view */}
      <div className="split-layout-pane">
        {/* Left: Ticket List */}
        <div className="main-pane-content" style={{ flex: 1.6 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <h3 className="chart-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Ticket size={15} style={{ color: '#2563eb' }} /> Support Ticket Logs
              </h3>
              <div style={{ position: 'relative', width: 220 }}>
                <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-4)' }} />
                <input
                  type="text"
                  placeholder="Search logsâ€¦"
                  className="input"
                  style={{ paddingLeft: 28, fontSize: 12, paddingTop: 5, paddingBottom: 5 }}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && load()}
                />
              </div>
            </div>

            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-4)' }}>Loading ticketsâ€¦</div>
            ) : tickets.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>
                No tickets found. Create one using the "New Ticket" button.
              </div>
            ) : (
              <table className="data-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th>Ticket ID</th>
                    <th>Subject</th>
                    <th>Customer</th>
                    <th>Priority</th>
                    <th>Created</th>
                    <th>SLA</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(t => {
                    const pm = PRIORITY_META[t.priority] || PRIORITY_META.Medium;
                    const sm = STATUS_META[t.status] || STATUS_META.Open;
                    return (
                      <tr
                        key={t.id}
                        style={{ cursor: 'pointer', background: selectedTicketId === t.id ? 'rgba(37,99,235,0.04)' : undefined }}
                        onClick={() => { setSelectedTicketId(t.id); setActiveTab('detail'); }}
                      >
                        <td style={{ fontWeight: 600, fontSize: 12, color: '#2563eb' }}>{t.ticket_number || `#${t.id}`}</td>
                        <td style={{ maxWidth: 180 }}>
                          <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.subject}</div>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-4)' }}>{t.customer_name}</td>
                        <td>
                          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: pm.bg, color: pm.color }}>{t.priority}</span>
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-4)' }}>{t.created_ago || t.created_at}</td>
                        <td style={{ fontSize: 11, fontWeight: 600, color: t.sla_breached ? '#ef4444' : '#16a34a' }}>{t.time_limit}</td>
                        <td>
                          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: sm.bg, color: sm.color }}>{t.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: Detail / New Ticket Panel */}
        <div className="details-pane-container" style={{ width: 360 }}>
          {/* Tab toggle */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {['detail', 'new'].map(tab => (
              <button
                key={tab}
                className={`btn btn-sm ${activeTab === tab ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'detail' ? 'Ticket Detail' : 'New Ticket'}
              </button>
            ))}
          </div>

          {activeTab === 'detail' ? (
            selectedTicket ? (
              <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{selectedTicket.ticket_number || `#${selectedTicket.id}`}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 2 }}>{selectedTicket.subject}</div>
                  </div>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                    ...(PRIORITY_META[selectedTicket.priority] || PRIORITY_META.Medium)
                  }}>{selectedTicket.priority}</span>
                </div>

                {/* Customer Info */}
                <div style={{ background: 'var(--bg-2)', borderRadius: 6, padding: '8px 12px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Customer</div>
                  <div style={{ fontSize: 12 }}>{selectedTicket.customer_name}</div>
                  {selectedTicket.customer_email && (
                    <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{selectedTicket.customer_email}</div>
                  )}
                </div>

                {/* Description */}
                {selectedTicket.description && (
                  <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>{selectedTicket.description}</div>
                )}

                {/* SLA */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-4)' }}>SLA Status</span>
                  <span style={{ fontWeight: 600, color: selectedTicket.sla_breached ? '#ef4444' : '#16a34a' }}>
                    {selectedTicket.time_limit}
                  </span>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8 }}>
                  {selectedTicket.status !== 'Resolved' && selectedTicket.status !== 'Closed' && (
                    <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => handleResolve(selectedTicket)}>
                      <CheckCircle2 size={12} /> Resolve
                    </button>
                  )}
                  {selectedTicket.status !== 'Closed' && (
                    <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => handleClose(selectedTicket)}>
                      Close
                    </button>
                  )}
                  <button className="btn btn-secondary btn-sm" style={{ color: '#ef4444' }} onClick={() => handleDelete(selectedTicket)}>
                    <X size={12} />
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>
                Select a ticket to view details
              </div>
            )
          ) : (
            /* New Ticket Form */
            <div className="card" style={{ padding: 18 }}>
              <h4 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>Create Support Ticket</h4>
              <form onSubmit={handleAddTicket} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Subject *</label>
                  <input className="input" style={{ width: '100%', fontSize: 12 }} placeholder="Brief description of the issue" value={subject} onChange={e => setSubject(e.target.value)} required />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Customer Name *</label>
                  <input className="input" style={{ width: '100%', fontSize: 12 }} placeholder="John Doe" value={customerName} onChange={e => setCustomerName(e.target.value)} required />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Customer Email</label>
                  <input className="input" type="email" style={{ width: '100%', fontSize: 12 }} placeholder="john@example.com" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Priority</label>
                  <select className="input" style={{ width: '100%', fontSize: 12 }} value={priority} onChange={e => setPriority(e.target.value)}>
                    <option>High</option>
                    <option>Medium</option>
                    <option>Low</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</label>
                  <textarea className="input" style={{ width: '100%', fontSize: 12, minHeight: 80, resize: 'vertical' }} placeholder="Detailed description..." value={descText} onChange={e => setDescText(e.target.value)} />
                </div>
                <button className="btn btn-primary" type="submit" disabled={submitting} style={{ marginTop: 4 }}>
                  {submitting ? 'Creating...' : 'Create Ticket'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

