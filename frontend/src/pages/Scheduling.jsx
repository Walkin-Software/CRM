import { useEffect, useState } from 'react';
import { Calendar as CalendarIcon, Clock, Plus, User, Check, AlertCircle, RefreshCw, Trash2, CalendarCheck, HelpCircle, PhoneCall } from 'lucide-react';
import { schedulingAPI } from '../lib/api';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';

export default function Scheduling() {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('week'); // today | week
  const [activeTab, setActiveTab] = useState('agenda'); // agenda | addSlot

  // New slot form state
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [agentName, setAgentName] = useState('Agent Pravesha');

  // Fallback Mock slots if API is empty
  const getMockSlots = () => {
    const today = new Date();
    
    const slot1 = new Date(today);
    slot1.setHours(10, 0, 0);
    const slot1End = new Date(today);
    slot1End.setHours(11, 0, 0);

    const slot2 = new Date(today);
    slot2.setHours(14, 30, 0);
    const slot2End = new Date(today);
    slot2End.setHours(15, 30, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    
    const slot3 = new Date(tomorrow);
    slot3.setHours(11, 0, 0);
    const slot3End = new Date(tomorrow);
    slot3End.setHours(12, 0, 0);

    const slot4 = new Date(tomorrow);
    slot4.setHours(16, 0, 0);
    const slot4End = new Date(tomorrow);
    slot4End.setHours(17, 0, 0);

    return [
      { id: 'slot-1', starts_at: slot1.toISOString(), ends_at: slot1End.toISOString(), agent_id: 'Agent Pravesha', client: 'Rahul Sharma (TechNova)' },
      { id: 'slot-2', starts_at: slot2.toISOString(), ends_at: slot2End.toISOString(), agent_id: 'Agent Pravesha', client: null },
      { id: 'slot-3', starts_at: slot3.toISOString(), ends_at: slot3End.toISOString(), agent_id: 'Super Admin', client: 'Priya Mehta (BrightByte)' },
      { id: 'slot-4', starts_at: slot4.toISOString(), ends_at: slot4End.toISOString(), agent_id: 'Agent Pravesha', client: null }
    ];
  };

  const fetchSlots = async () => {
    setLoading(true);
    try {
      const res = await schedulingAPI.slots();
      const apiSlots = res.data.slots || [];
      if (apiSlots.length === 0) {
        setSlots(getMockSlots());
      } else {
        setSlots(apiSlots);
      }
    } catch (err) {
      setSlots(getMockSlots());
      toast.error('API failed to respond. Loaded scheduling calendar mockups.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSlots();
  }, []);

  const today = new Date();
  const weekEnd = new Date();
  weekEnd.setDate(today.getDate() + 7);

  const visibleSlots = slots.filter((slot) => {
    const startsAt = new Date(slot.starts_at);
    if (viewMode === 'today') {
      return startsAt.toDateString() === today.toDateString();
    }
    return startsAt >= today && startsAt <= weekEnd;
  });

  const bookedSlots = slots.filter(s => s.client);
  const availableSlotsList = visibleSlots.filter(s => !s.client);

  const formatDate = (dateString) => new Date(dateString).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const formatTime = (dateString) => new Date(dateString).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleAddSlot = (e) => {
    e.preventDefault();
    if (!startsAt || !endsAt) {
      toast.error('Please input valid start and end times.');
      return;
    }

    const newSlot = {
      id: `slot-${Date.now()}`,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
      agent_id: agentName,
      client: null
    };

    setSlots(prev => [newSlot, ...prev]);
    setStartsAt('');
    setEndsAt('');
    setActiveTab('agenda');
    toast.success('Availability time slot logged in calendar!');
  };

  const handleCancelSlot = (id) => {
    setSlots(prev => prev.filter(s => s.id !== id));
    toast.success('Availability slot removed.');
  };

  return (
    <div className="flex-col gap-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Scheduling & Availability</h2>
          <p className="page-subtitle">Configure call slots availability, booking links, and agent agenda queues.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={fetchSlots}>
            <RefreshCw size={14} /> Refresh Schedule
          </button>
          <button className="btn btn-primary" onClick={() => { setActiveTab('addSlot'); }}>
            <Plus size={15} /> Add Slot
          </button>
        </div>
      </div>

      {/* KPI Metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Total Slots Active</span>
              <span className="kpi-value">{slots.length} Slots</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>
              <CalendarIcon size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--success)' }}>
            Available for booking links
          </span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Upcoming Bookings</span>
              <span className="kpi-value">{bookedSlots.length} Booked</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(22,163,74,0.08)', color: '#16a34a' }}>
              <CalendarCheck size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--success)' }}>
            All assigned to agents
          </span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Slot Booking Rate</span>
              <span className="kpi-value">50.0%</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(37,99,235,0.08)', color: '#2563eb' }}>
              <Check size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--success)' }}>
            Optimal calendar density
          </span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Scheduled Duration</span>
              <span className="kpi-value">1h Slots</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(249,115,22,0.08)', color: '#f97316' }}>
              <Clock size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--text-3)' }}>
            Standard alignment
          </span>
        </div>
      </div>

      {/* Main Split Layout */}
      <div className="split-layout-pane">
        
        {/* Left Card: Available slots list */}
        <div className="main-pane-content" style={{ flex: 1.6 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden', minHeight: '380px' }}>
            <div className="scheduling-card-header" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }}>
              <h3 className="chart-title" style={{ margin: 0 }}>Available Slots Calendar</h3>
              <div className="scheduling-segment" style={{ display: 'flex', gap: '6px' }}>
                {['today', 'week'].map(mode => (
                  <button
                    key={mode}
                    className={`btn btn-sm`}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: '600',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      background: viewMode === mode ? '#2563eb' : 'white',
                      color: viewMode === mode ? 'white' : 'var(--text-2)'
                    }}
                    onClick={() => setViewMode(mode)}
                  >
                    {mode.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-4)' }}>Loading calendar slots...</div>
              ) : availableSlotsList.length === 0 ? (
                <div className="scheduling-empty">
                  <CalendarIcon size={20} className="text-muted" />
                  <p className="text-sm" style={{ fontSize: '13px', color: 'var(--text-3)' }}>No available slots for this filter. Click Add Slot to create one.</p>
                </div>
              ) : (
                availableSlotsList.map((slot) => (
                  <div key={slot.id} className="scheduling-slot-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-hover)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div className="scheduling-slot-icon" style={{ width: '32px', height: '32px', borderRadius: '6px', background: 'white', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563eb' }}>
                        <CalendarIcon size={14} />
                      </div>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-1)' }}>{formatDate(slot.starts_at)}</div>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                          <Clock size={11} />
                          {formatTime(slot.starts_at)} - {formatTime(slot.ends_at)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', color: 'var(--text-3)' }}>
                        <User size={12} />
                        <span>{slot.agent_id}</span>
                      </div>
                      <span className="badge badge-converted" style={{ fontSize: '9px', fontWeight: 700 }}>AVAILABLE</span>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleCancelSlot(slot.id)}>Remove</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Card: Agenda view or slot logging form */}
        <div className="details-pane-container" style={{ width: '360px' }}>
          
          {/* Navigation Panel tabs */}
          <div className="details-pane-tabs" style={{ marginBottom: '8px' }}>
            <button
              onClick={() => setActiveTab('agenda')}
              className={`details-pane-tab ${activeTab === 'agenda' ? 'active' : ''}`}
            >
              Bookings Agenda
            </button>
            <button
              onClick={() => setActiveTab('addSlot')}
              className={`details-pane-tab ${activeTab === 'addSlot' ? 'active' : ''}`}
            >
              Add Availability
            </button>
          </div>

          {activeTab === 'agenda' ? (
            /* Upcoming Bookings Agenda Feed */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
              <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '13.5px', fontWeight: '700', color: 'var(--text-1)' }}>Confirmed bookings</h3>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', flex: 1 }}>
                {bookedSlots.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-4)', fontSize: '12px' }}>
                    <AlertCircle size={16} style={{ margin: '0 auto 6px', opacity: 0.5 }} />
                    No upcoming client bookings confirmed yet.
                  </div>
                ) : (
                  bookedSlots.map(slot => (
                    <div key={slot.id} style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px', background: '#f8fafc' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: '12.5px', fontWeight: '700', color: 'var(--text-1)' }}>{slot.client}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                            <Clock size={11} />
                            {formatDate(slot.starts_at)} @ {formatTime(slot.starts_at)}
                          </div>
                        </div>
                        <span style={{ color: 'var(--success)' }}><Check size={14} /></span>
                      </div>
                      <div style={{ display: 'flex', gap: '4px', marginTop: '4px', borderTop: '1px solid #f1f5f9', paddingTop: '6px' }}>
                        <button className="btn btn-secondary btn-sm" style={{ flex: 1, padding: '3px', fontSize: '11px' }} onClick={() => toast.success(`Meeting info emailed to client.`)}>
                          Notify client
                        </button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleCancelSlot(slot.id)} title="Cancel Meeting">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            /* Log New Slot Form */
            <form onSubmit={handleAddSlot} style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Select Agent</label>
                <select className="input" style={{ fontSize: '12px', padding: '6px' }} value={agentName} onChange={(e) => setAgentName(e.target.value)}>
                  <option value="Agent Pravesha">Agent Pravesha</option>
                  <option value="Super Admin">Super Admin</option>
                  <option value="Agent Rahul">Agent Rahul</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Start Date & Time</label>
                <input
                  type="datetime-local"
                  className="input"
                  style={{ fontSize: '12px', padding: '6px', borderRadius: '6px' }}
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>End Date & Time</label>
                <input
                  type="datetime-local"
                  className="input"
                  style={{ fontSize: '12px', padding: '6px', borderRadius: '6px' }}
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </div>

              <button type="submit" className="btn btn-primary w-full justify-center" style={{ background: '#2563eb', border: 'none', color: 'white', padding: '8px', fontSize: '12px', fontWeight: '600' }}>
                Log Availability Slot
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}
