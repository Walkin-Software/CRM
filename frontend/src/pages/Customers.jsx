import { useState, useEffect, useCallback } from 'react';
import { UserCheck, Star, Sparkles, Shield, UserX, PhoneCall, Building2, Calendar, FileText, Plus, Check, RefreshCw, Search } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { customersAPI, callsAPI } from '../lib/api';

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [search, setSearch] = useState('');

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId) || customers[0] || null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        customersAPI.list({ page: 1, page_size: 100, search: search || undefined }),
        customersAPI.stats(),
      ]);
      const items = listRes.data?.items || [];
      setCustomers(items);
      setStats(statsRes.data);
      if (items.length && !selectedCustomerId) {
        setSelectedCustomerId(items[0].id);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load customers. Check backend connection.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!newNote.trim() || !selectedCustomer) return;
    setSavingNote(true);
    try {
      const updatedNotes = selectedCustomer.notes
        ? `${selectedCustomer.notes}\nÂ· ${newNote.trim()}`
        : `Â· ${newNote.trim()}`;
      await customersAPI.update(selectedCustomer.id, { notes: updatedNotes });
      setCustomers(prev => prev.map(c =>
        c.id === selectedCustomer.id ? { ...c, notes: updatedNotes } : c
      ));
      setNewNote('');
      toast.success('Customer notes updated successfully!');
    } catch {
      toast.error('Failed to save note.');
    } finally {
      setSavingNote(false);
    }
  };

  const handleCallCustomer = (customer) => {
    callsAPI.outbound({ phone: customer.phone, lead_id: customer.id })
      .then(() => toast.success(`Initiating call to ${customer.name} at ${customer.phone}...`))
      .catch(() => toast.error('Failed to initiate call. Check Twilio config.'));
  };

  const satisfactionLabel = (score) => {
    if (!score) return 'Good';
    if (score >= 90) return 'Excellent';
    if (score >= 70) return 'Good';
    return 'Poor';
  };

  const satisfactionColor = (score) => {
    if (!score) return '#16a34a';
    if (score >= 90) return '#7c3aed';
    if (score >= 70) return '#16a34a';
    return '#ef4444';
  };

  return (
    <div className="flex-col gap-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Customers Directory</h2>
          <p className="page-subtitle">Examine corporate client contracts, subscription levels, recurring monthly revenues, and loyalty index scores.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* KPI Stats Overview Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Active Contracts</span>
              <span className="kpi-value">{loading ? '...' : (stats?.active_contracts ?? '--')}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(22,163,74,0.08)', color: '#16a34a' }}>
              <UserCheck size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: '#16a34a' }}>Converted leads</span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Total Monthly MRR</span>
              <span className="kpi-value" style={{ fontSize: '14px' }}>{loading ? '...' : (stats?.total_mrr_formatted ?? 'INR 0')}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>
              <Sparkles size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--text-4)' }}>This billing cycle</span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Satisfaction Score</span>
              <span className="kpi-value">{loading ? '...' : `${stats?.satisfaction_score ?? 0}%`}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(249,115,22,0.08)', color: '#f97316' }}>
              <Star size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: '#16a34a' }}>+4% vs last month</span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">VIP Customers</span>
              <span className="kpi-value">{loading ? '...' : (stats?.vip_customers ?? '--')}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
              <Shield size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--text-4)' }}>Hot temperature leads</span>
        </div>
      </div>

      {/* Search Bar */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-4)' }} />
          <input
            className="input"
            style={{ paddingLeft: 32, width: '100%' }}
            placeholder="Search by name, email or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
          />
        </div>
        <button className="btn btn-primary btn-sm" onClick={load}>Search</button>
      </div>

      {/* Main Split Layout */}
      <div className="split-layout-pane">
        {/* Left Customer Table Section */}
        <div className="main-pane-content" style={{ flex: 1.6 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="chart-title" style={{ margin: 0 }}>Corporate Subscribers List</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => toast.success('CSV export initiated.')}>Export Data</button>
            </div>

            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-4)' }}>Loading customers...</div>
            ) : customers.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>
                No converted customers yet. Leads with status "converted" appear here.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th>Customer</th>
                    <th>Email</th>
                    <th>Plan</th>
                    <th>Joined</th>
                    <th>Score</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map(c => (
                    <tr
                      key={c.id}
                      style={{ cursor: 'pointer', background: selectedCustomerId === c.id ? 'rgba(37,99,235,0.04)' : undefined }}
                      onClick={() => setSelectedCustomerId(c.id)}
                    >
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{c.phone}</div>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-4)' }}>{c.email || '--'}</td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: c.plan === 'Enterprise' ? 'rgba(124,58,237,0.1)' : 'rgba(37,99,235,0.08)', color: c.plan === 'Enterprise' ? '#7c3aed' : '#2563eb' }}>
                          {c.plan}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-4)' }}>{c.joined}</td>
                      <td style={{ fontWeight: 700, color: c.score >= 70 ? '#16a34a' : '#f97316' }}>{c.score}</td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: c.status === 'Active' ? 'rgba(22,163,74,0.08)' : 'rgba(239,68,68,0.08)', color: c.status === 'Active' ? '#16a34a' : '#ef4444' }}>
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right Details Panel */}
        <div className="details-pane-container" style={{ width: '360px' }}>
          {selectedCustomer ? (
            <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg,#2563eb,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 16 }}>
                  {selectedCustomer.name?.[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{selectedCustomer.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{selectedCustomer.interest || 'Customer'}</div>
                </div>
              </div>

              {/* Info rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                {[
                  ['Plan', selectedCustomer.plan],
                  ['Status', selectedCustomer.status],
                  ['Score', selectedCustomer.score],
                  ['Satisfaction', `${satisfactionLabel(selectedCustomer.score)} (${stats?.satisfaction_score ?? '--'}%)`],
                  ['Joined', selectedCustomer.joined],
                  ['Source', selectedCustomer.source],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-4)', fontWeight: 500 }}>{label}</span>
                    <span style={{ fontWeight: 600 }}>{value || '--'}</span>
                  </div>
                ))}
              </div>

              {/* Contact actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => handleCallCustomer(selectedCustomer)}>
                  <PhoneCall size={12} /> Call
                </button>
                <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => toast.success(`Email drafted to ${selectedCustomer.email}`)}>
                  Email
                </button>
              </div>

              {/* Notes */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text-2)' }}>Account Notes</div>
                <div style={{ fontSize: 12, color: 'var(--text-4)', background: 'var(--bg-2)', borderRadius: 6, padding: '8px 10px', minHeight: 60, whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}>
                  {selectedCustomer.notes || 'No notes yet.'}
                </div>
              </div>

              {/* Add note form */}
              <form onSubmit={handleAddNote} style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  style={{ flex: 1, fontSize: 12 }}
                  placeholder="Add a note..."
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                />
                <button className="btn btn-primary btn-sm" type="submit" disabled={savingNote}>
                  <Check size={12} />
                </button>
              </form>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-4)', fontSize: 13 }}>
              Select a customer to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

