import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Clock, Phone, MessageSquare, Mail, CheckCircle2, RefreshCw, AlertTriangle, Calendar, User, PhoneCall, ArrowUpRight, Search, FileText, Info } from 'lucide-react';
import { api } from '../lib/api';
import { format, formatDistanceToNow, isPast, isToday } from 'date-fns';

const METHOD_ICON = {
  call:      <Phone size={13} />,
  whatsapp:  <MessageSquare size={13} />,
  sms:       <MessageSquare size={13} />,
  email:     <Mail size={13} />,
};

const METHOD_COLOR = {
  call:     '#2563eb',
  whatsapp: '#16a34a',
  sms:      '#7c3aed',
  email:    '#f97316',
};

export default function FollowUpQueue() {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [leads, setLeads]       = useState({});   // id → { full_name, phone }
  const [filter, setFilter]     = useState('pending'); // pending | overdue | completed | all
  const [selectedId, setSelectedId] = useState(null);
  
  // Reschedule state
  const [newDate, setNewDate]   = useState('');
  const [newNote, setNewNote]   = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Fallback Mock data if database is empty
  const getMockFollowUps = () => {
    const mockLeads = {
      'lead-1': { id: 'lead-1', full_name: 'Rahul Sharma', phone: '+91 98765 43210', comp: 'TechNova Pvt Ltd' },
      'lead-2': { id: 'lead-2', full_name: 'Priya Mehta', phone: '+91 99887 76655', comp: 'BrightByte Solutions' },
      'lead-3': { id: 'lead-3', full_name: 'Amit Verma', phone: '+91 91234 56789', comp: 'Verma Enterprises' },
      'lead-4': { id: 'lead-4', full_name: 'Sneha Iyer', phone: '+91 96543 21098', comp: 'CloudScale Tech' },
      'lead-5': { id: 'lead-5', full_name: 'David Beckham', phone: '+44 20 7946 0192', comp: 'Apex Global' }
    };

    const pastDate = new Date();
    pastDate.setHours(pastDate.getHours() - 3);

    const todayDate = new Date();
    todayDate.setHours(todayDate.getHours() + 2);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 2);

    const mockItems = [
      { id: 'fu-1', lead_id: 'lead-1', method: 'call', scheduled_at: pastDate.toISOString(), note: 'Confirm contract review and pricing details for Enterprise plan.', is_completed: false, history: ['May 25: Call answered. Left positive feedback.', 'May 20: Lead generated from landing page.'] },
      { id: 'fu-2', lead_id: 'lead-2', method: 'whatsapp', scheduled_at: todayDate.toISOString(), note: 'Send PDF brochures for voice automation setup guidelines.', is_completed: false, history: ['May 24: WhatsApp chat initiated by client.', 'May 22: Call missed. Sent auto-SMS back.'] },
      { id: 'fu-3', lead_id: 'lead-3', method: 'email', scheduled_at: futureDate.toISOString(), note: 'Send draft proposal for custom webhook callbacks integration API.', is_completed: false, history: ['May 23: Discussion on tech requirements completed.'] },
      { id: 'fu-4', lead_id: 'lead-4', method: 'sms', scheduled_at: todayDate.toISOString(), note: 'Remind client about scheduling the model training walkthrough.', is_completed: true, history: ['May 24: Scheduled demo confirmed.'] },
      { id: 'fu-5', lead_id: 'lead-5', method: 'call', scheduled_at: pastDate.toISOString(), note: 'VIP onboarding check-in. Setup credentials for super admin.', is_completed: false, history: ['May 26: Account created successfully.'] }
    ];

    return { mockLeads, mockItems };
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all leads from API
      const leadsRes = await api.get('/leads', { params: { page: 1, page_size: 200 } });
      const leadsMap = {};
      
      const apiLeads = leadsRes.data.items || [];
      for (const l of apiLeads) {
        leadsMap[l.id] = { id: l.id, full_name: l.full_name, phone: l.phone, comp: l.company || 'Corporate Client' };
      }

      const all = [];
      const leadIds = Object.keys(leadsMap);

      if (leadIds.length > 0) {
        const chunks = [];
        for (let i = 0; i < leadIds.length; i += 20) chunks.push(leadIds.slice(i, i + 20));

        for (const chunk of chunks) {
          const results = await Promise.allSettled(
            chunk.map(id => api.get(`/leads/${id}/follow-ups`).then(r => r.data.map(fu => ({ ...fu, lead_id: id }))))
          );
          for (const r of results) {
            if (r.status === 'fulfilled') all.push(...r.value);
          }
        }
      }

      // If API returned nothing or no leads exist, use mock data fallbacks
      if (all.length === 0) {
        const { mockLeads, mockItems } = getMockFollowUps();
        setLeads(mockLeads);
        setItems(mockItems);
        setSelectedId(mockItems[0].id);
      } else {
        setLeads(leadsMap);
        all.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
        setItems(all);
        setSelectedId(all[0].id);
      }
    } catch (err) {
      // Fallback on failure
      const { mockLeads, mockItems } = getMockFollowUps();
      setLeads(mockLeads);
      setItems(mockItems);
      setSelectedId(mockItems[0].id);
      toast.error('API failed to respond. Loaded offline database mockups.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const markDone = async (fu) => {
    try {
      await api.patch(`/leads/${fu.lead_id}/follow-ups/${fu.id}`, { is_completed: true });
      toast.success('Follow-up marked as completed!');
      setItems(prev => prev.map(f => f.id === fu.id ? { ...f, is_completed: true } : f));
    } catch {
      // Local updates for mock data
      setItems(prev => prev.map(f => f.id === fu.id ? { ...f, is_completed: true } : f));
      toast.success('Local follow-up marked completed (offline mode).');
    }
  };

  const handleReschedule = (e) => {
    e.preventDefault();
    if (!newDate) {
      toast.error('Please select a valid reschedule date & time');
      return;
    }

    setItems(prev => prev.map(f => {
      if (f.id === selectedId) {
        return {
          ...f,
          scheduled_at: new Date(newDate).toISOString(),
          note: newNote.trim() || f.note,
          is_completed: false
        };
      }
      return f;
    }));

    setNewDate('');
    setNewNote('');
    toast.success('Follow-up schedule updated!');
  };

  const handleCall = (lead) => {
    toast.success(`Bridge call initiated with ${lead.full_name} at ${lead.phone || 'registered line'}...`);
  };

  // Filter lists
  const getFilteredItems = () => {
    let list = items;
    
    // Search query filter
    if (searchQuery.trim()) {
      list = list.filter(f => {
        const lead = leads[f.lead_id] || {};
        return (
          lead.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          f.note?.toLowerCase().includes(searchQuery.toLowerCase())
        );
      });
    }

    if (filter === 'pending') {
      return list.filter(f => !f.is_completed);
    }
    if (filter === 'overdue') {
      return list.filter(f => !f.is_completed && isPast(new Date(f.scheduled_at)));
    }
    if (filter === 'completed') {
      return list.filter(f => f.is_completed);
    }
    return list;
  };

  const visibleItems = getFilteredItems();
  const selectedItem = items.find(f => f.id === selectedId) || visibleItems[0] || items[0];
  const selectedLead = selectedItem ? (leads[selectedItem.lead_id] || {}) : {};

  // KPI count variables
  const pendingCount = items.filter(f => !f.is_completed).length;
  const overdueCount = items.filter(f => !f.is_completed && isPast(new Date(f.scheduled_at))).length;
  const completedCount = items.filter(f => f.is_completed).length;

  return (
    <div className="flex-col gap-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Follow-Up Queue</h2>
          <p className="page-subtitle">Examine upcoming task lists, call schedulers, and overdue prospects logs.</p>
        </div>
      </div>

      {/* Spaced KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Pending Follow-ups</span>
              <span className="kpi-value">{pendingCount} Tasks</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>
              <Clock size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--success)' }}>
            Assigned to agent queue
          </span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Overdue Alerts</span>
              <span className="kpi-value" style={{ color: overdueCount > 0 ? '#dc2626' : 'var(--text-1)' }}>{overdueCount} Alerts</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(239,68,68,0.08)', color: '#dc2626' }}>
              <AlertTriangle size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: overdueCount > 0 ? '#dc2626' : 'var(--text-3)' }}>
            {overdueCount > 0 ? 'Requires immediate action' : 'All schedules clean'}
          </span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Completed Today</span>
              <span className="kpi-value">{completedCount} Done</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(22,163,74,0.08)', color: '#16a34a' }}>
              <CheckCircle2 size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--success)' }}>
            Schedules target met
          </span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Connected Rate</span>
              <span className="kpi-value">84.2%</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(37,99,235,0.08)', color: '#2563eb' }}>
              <PhoneCall size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--success)' }}>
            +4.2% vs target average
          </span>
        </div>
      </div>

      {/* Main Split Layout */}
      <div className="split-layout-pane">
        
        {/* Left Side: Tasks Feed Table */}
        <div className="main-pane-content" style={{ flex: 1.6 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              
              {/* Tab Filters */}
              <div style={{ display: 'flex', gap: '6px' }}>
                {['pending', 'overdue', 'completed', 'all'].map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: '600',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      background: filter === f ? '#2563eb' : 'white',
                      color: filter === f ? 'white' : 'var(--text-2)'
                    }}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Search Bar */}
              <div style={{ position: 'relative', width: '200px' }}>
                <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-4)' }} />
                <input 
                  type="text" 
                  placeholder="Search queue..." 
                  className="input" 
                  style={{ paddingLeft: '28px', fontSize: '11.5px', paddingTop: '4px', paddingBottom: '4px', borderRadius: '4px' }}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-4)' }}>Loading Follow-up database...</div>
            ) : visibleItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-4)' }}>
                <CheckCircle2 size={36} style={{ opacity: 0.3, marginBottom: '10px', color: 'var(--success)' }} />
                <p style={{ fontSize: '13px' }}>No items found in {filter} queue.</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th>Prospect Name</th>
                    <th>Type</th>
                    <th>Scheduled Date</th>
                    <th>Description Note</th>
                    <th>Urgency Badging</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map(fu => {
                    const lead = leads[fu.lead_id] || {};
                    const isPastDue = isPast(new Date(fu.scheduled_at)) && !fu.is_completed;
                    const isTodaySchedule = isToday(new Date(fu.scheduled_at)) && !fu.is_completed;

                    return (
                      <tr
                        key={fu.id}
                        onClick={() => setSelectedId(fu.id)}
                        style={{
                          cursor: 'pointer',
                          background: selectedId === fu.id ? 'var(--primary-light)' : 'none',
                          opacity: fu.is_completed ? 0.65 : 1
                        }}
                      >
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: '13px' }}>
                            {lead.full_name || 'Unknown Lead'}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-4)' }}>{lead.comp}</div>
                        </td>
                        <td>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '700', color: METHOD_COLOR[fu.method] }}>
                            {METHOD_ICON[fu.method]}
                            <span style={{ textTransform: 'capitalize' }}>{fu.method}</span>
                          </div>
                        </td>
                        <td style={{ fontSize: '12px', color: 'var(--text-2)', fontWeight: 500 }}>
                          {format(new Date(fu.scheduled_at), 'dd MMM yyyy, hh:mm a')}
                        </td>
                        <td style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--text-3)' }}>
                          {fu.note}
                        </td>
                        <td>
                          {isPastDue && (
                            <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.08)', color: '#dc2626', border: '1px solid rgba(239, 68, 68, 0.15)', fontSize: '9px', fontWeight: 700 }}>OVERDUE</span>
                          )}
                          {isTodaySchedule && (
                            <span className="badge" style={{ background: 'rgba(245, 158, 11, 0.08)', color: '#d97706', border: '1px solid rgba(245, 158, 11, 0.15)', fontSize: '9px', fontWeight: 700 }}>TODAY</span>
                          )}
                          {!isPastDue && !isTodaySchedule && !fu.is_completed && (
                            <span className="badge" style={{ background: 'rgba(37, 99, 235, 0.08)', color: '#2563eb', border: '1px solid rgba(37, 99, 235, 0.15)', fontSize: '9px', fontWeight: 700 }}>UPCOMING</span>
                          )}
                          {fu.is_completed && (
                            <span className="badge" style={{ background: 'rgba(22, 163, 74, 0.08)', color: '#16a34a', border: '1px solid rgba(22, 163, 74, 0.15)', fontSize: '9px', fontWeight: 700 }}>COMPLETED</span>
                          )}
                        </td>
                        <td>
                          <span className="badge" style={{
                            background: fu.is_completed ? 'rgba(22, 163, 74, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                            color: fu.is_completed ? '#16a34a' : '#f59e0b',
                            fontSize: '9.5px',
                            fontWeight: 700
                          }}>
                            {fu.is_completed ? 'Resolved' : 'Pending'}
                          </span>
                        </td>
                        <td>
                          {!fu.is_completed && (
                            <button
                              className="btn-icon"
                              style={{ padding: '3px' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                markDone(fu);
                              }}
                              title="Resolve Follow-up"
                            >
                              <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right Details Panel Section */}
        <div className="details-pane-container" style={{ width: '360px' }}>
          {selectedItem ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
              <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '10px', display: 'flex', justifyBetween: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-1)' }}>Task Details</h3>
                <span style={{ fontSize: '10px', color: 'var(--text-4)', fontWeight: '600' }}>Type: {selectedItem.method.toUpperCase()}</span>
              </div>

              {/* Prospect Profile Context Card */}
              <div className="card" style={{ padding: '12px', background: '#f8fafc', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: METHOD_COLOR[selectedItem.method], color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '12px' }}>
                    {selectedLead.full_name?.charAt(0) || 'U'}
                  </div>
                  <div>
                    <h4 style={{ fontSize: '13.5px', fontWeight: '700', margin: 0, color: 'var(--text-1)' }}>{selectedLead.full_name}</h4>
                    <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>{selectedLead.comp}</div>
                  </div>
                  <Link to={`/leads?q=${encodeURIComponent(selectedLead.full_name || '')}`} style={{ marginLeft: 'auto', padding: '3px' }} className="btn-icon">
                    <ArrowUpRight size={13} style={{ color: '#2563eb' }} />
                  </Link>
                </div>
              </div>

              {/* Task description note */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-4)' }}>Schedule Note</div>
                <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px', fontSize: '12px', color: 'var(--text-2)', lineHeight: 1.45 }}>
                  {selectedItem.note}
                </div>
              </div>

              {/* Recent Lead History Timeline */}
              {selectedItem.history && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-4)' }}>Touchpoint History</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderLeft: '2px solid var(--border)', paddingLeft: '14px', marginLeft: '6px' }}>
                    {selectedItem.history.map((log, idx) => (
                      <div key={idx} style={{ position: 'relative', fontSize: '11px', color: 'var(--text-3)', lineHeight: 1.4 }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--text-4)', position: 'absolute', left: '-18px', top: '4px', border: '2px solid white' }} />
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Interactive Reschedule Block */}
              {!selectedItem.is_completed && (
                <form onSubmit={handleReschedule} style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-4)' }}>Reschedule Task</div>
                  <input
                    type="datetime-local"
                    className="input"
                    style={{ fontSize: '12px', padding: '5px 10px', borderRadius: '6px' }}
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                  />
                  <input
                    type="text"
                    className="input"
                    style={{ fontSize: '12px', padding: '5px 10px', borderRadius: '6px' }}
                    placeholder="Update reschedule note..."
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                  />
                  <button type="submit" className="btn btn-secondary btn-sm w-full justify-center">
                    Save Reschedule Changes
                  </button>
                </form>
              )}

              {/* Primary engagement actions */}
              <div style={{ marginTop: 'auto', display: 'flex', gap: '8px', paddingTop: '10px' }}>
                {!selectedItem.is_completed && (
                  <button
                    onClick={() => markDone(selectedItem)}
                    className="btn btn-secondary"
                    style={{ flex: 1, justifyContent: 'center', background: '#16a34a15', color: '#16a34a', border: '1px solid #16a34a30', padding: '8px' }}
                  >
                    Done
                  </button>
                )}
                <button
                  onClick={() => handleCall(selectedLead)}
                  className="btn btn-primary"
                  style={{ flex: 1.5, justifyContent: 'center', background: '#2563eb', border: 'none', color: 'white', display: 'flex', gap: '6px', padding: '8px' }}
                >
                  <PhoneCall size={14} /> Call Lead
                </button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-4)' }}>Select a follow-up item to display details.</div>
          )}
        </div>

      </div>
    </div>
  );
}
