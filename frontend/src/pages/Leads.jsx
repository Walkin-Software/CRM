import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Filter, Plus, UserPlus,
  MoreHorizontal, Phone, MessageSquare, Send,
  Download, Upload, ChevronLeft, ChevronRight, X
} from 'lucide-react';
import { leadsAPI, callsAPI, notificationsAPI, api } from '../lib/api';
import { toast } from 'react-hot-toast';

export default function Leads() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [savingLead, setSavingLead] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const csvInputRef = useRef(null);
  const [waModal, setWaModal] = useState({ open: false, lead: null, message: '' });
  const [sendingWA, setSendingWA] = useState(false);
  const [newLead, setNewLead] = useState({
    full_name: '',
    phone: '',
    email: '',
    interest: '',
    source: 'manual',
    lead_type: 'form',
    job_role: '',
    years_experience: '',
  });

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const res = await leadsAPI.list({ 
        page, 
        page_size: 10, 
        search, 
        status: status || undefined 
      });
      setLeads(res.data.items);
      setTotal(res.data.total);
    } catch (err) {
      toast.error('Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
    
    // Auto-refresh every 15 seconds to catch new automated leads
    const interval = setInterval(fetchLeads, 15000);
    return () => clearInterval(interval);
  }, [page, status]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchLeads();
  };

  const handleCall = async (lead) => {
    if (!lead.phone) {
      toast.error('Lead has no phone number');
      return;
    }
    try {
      toast.loading(`Initiating call to ${lead.full_name}...`, { id: `call-${lead.id}` });
      await callsAPI.outbound({
        to_number: lead.phone,
        lead_id: lead.id
      });
      toast.success('AI Agent is calling!', { id: `call-${lead.id}` });
    } catch (err) {
      toast.error('Failed to initiate call', { id: `call-${lead.id}` });
    }
  };

  const handleMessage = async (lead) => {
    if (!lead.phone) {
      toast.error('Lead has no phone number');
      return;
    }
    try {
      toast.loading(`Generating and sending AI message to ${lead.full_name}...`, { id: `msg-${lead.id}` });
      await notificationsAPI.generateAndSend({ lead_id: lead.id });
      toast.success('AI message sent!', { id: `msg-${lead.id}` });
    } catch (err) {
      toast.error('Failed to send message', { id: `msg-${lead.id}` });
    }
  };

  const resetNewLead = () => {
    setNewLead({
      full_name: '',
      phone: '',
      email: '',
      interest: '',
      source: 'manual',
      lead_type: 'form',
      job_role: '',
      years_experience: '',
    });
  };

  const handleCreateLead = async (e) => {
    e.preventDefault();
    if (!newLead.full_name.trim() || !newLead.phone.trim()) {
      toast.error('Name and phone are required');
      return;
    }

    setSavingLead(true);
    try {
      await leadsAPI.create({
        full_name: newLead.full_name.trim(),
        phone: newLead.phone.trim(),
        email: newLead.email.trim() || null,
        interest: newLead.interest.trim() || null,
        source: newLead.source,
        lead_type: newLead.lead_type,
        job_role: newLead.job_role.trim() || null,
        years_experience: newLead.years_experience === '' ? null : Number(newLead.years_experience),
      });
      toast.success('Lead added successfully');
      setShowAddModal(false);
      resetNewLead();
      setPage(1);
      await fetchLeads();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to add lead');
    } finally {
      setSavingLead(false);
    }
  };

  const escapeCsv = (value) => {
    const raw = value == null ? '' : String(value);
    return `"${raw.replace(/"/g, '""')}"`;
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = [];
      let pageNo = 1;
      const pageSize = 100;

      while (true) {
        const res = await leadsAPI.list({
          page: pageNo,
          page_size: pageSize,
          search,
          status: status || undefined,
        });
        const items = res.data.items || [];
        rows.push(...items);
        if (items.length < pageSize) break;
        pageNo += 1;
        if (pageNo > 100) break;
      }

      if (!rows.length) {
        toast.error('No leads to export');
        return;
      }

      const headers = [
        'ID',
        'Name',
        'Phone',
        'Email',
        'Interest',
        'Status',
        'Source',
        'Lead Type',
        'Job Role',
        'Years Experience',
        'Created At',
      ];

      const csvLines = [headers.map(escapeCsv).join(',')];
      rows.forEach((lead) => {
        csvLines.push([
          lead.id,
          lead.full_name,
          lead.phone,
          lead.email,
          lead.interest,
          lead.status,
          lead.source,
          lead.lead_type,
          lead.job_role,
          lead.years_experience,
          lead.created_at,
        ].map(escapeCsv).join(','));
      });

      const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `leads_export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast.success(`Exported ${rows.length} leads`);
    } catch (err) {
      toast.error('Failed to export leads');
    } finally {
      setExporting(false);
    }
  };

  const handleWhatsApp = (lead) => {
    if (!lead.phone) { toast.error('Lead has no phone number'); return; }
    const firstName = lead.full_name?.split(' ')[0] || 'there';
    setWaModal({
      open: true,
      lead,
      message: `Hi ${firstName}! 👋 This is a message from Walkin Software. We noticed your interest in our courses. Would you like to know more or schedule a free demo call?`,
    });
  };

  const sendWhatsApp = async () => {
    if (!waModal.message.trim() || !waModal.lead) return;
    setSendingWA(true);
    try {
      await api.post('/notifications/send', {
        lead_id: waModal.lead.id,
        channel: 'whatsapp',
        to: waModal.lead.phone,
        body: waModal.message.trim(),
      });
      toast.success(`WhatsApp sent to ${waModal.lead.full_name}`);
      setWaModal({ open: false, lead: null, message: '' });
    } catch (err) {
      const detail = err.response?.data?.detail || 'Failed to send WhatsApp message';
      toast.error(typeof detail === 'string' ? detail : 'Failed to send WhatsApp message');
    } finally {
      setSendingWA(false);
    }
  };

  const handleImportCSV = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/leads/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const { created, skipped, error_count } = res.data;
      toast.success(`Imported ${created} leads · ${skipped} duplicates skipped${error_count ? ` · ${error_count} errors` : ''}`);
      fetchLeads();
    } catch (err) {
      const msg = err.response?.data?.detail || 'CSV import failed';
      toast.error(typeof msg === 'string' ? msg : 'CSV import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex-col gap-6">
      <div className="page-header">
        <div>
          <h2 className="page-title">Lead Management</h2>
          <p className="page-subtitle">Track and nurture your sales pipeline</p>
        </div>
        <div className="flex gap-3">
          {/* Hidden file input for CSV import */}
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={handleImportCSV}
          />
          <button className="btn btn-secondary" onClick={() => csvInputRef.current?.click()} disabled={importing}>
            <Upload size={18} /> {importing ? 'Importing...' : 'Import CSV'}
          </button>
          <button className="btn btn-secondary" onClick={handleExport} disabled={exporting}>
            <Download size={18} /> {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={18} /> Add Lead
          </button>
        </div>
      </div>

      <div className="card">
        <form className="search-bar" onSubmit={handleSearch}>
          <div className="input-with-icon" style={{ flex: 1 }}>
            <Search className="input-icon" />
            <input 
              type="text" 
              className="input" 
              placeholder="Search by name, email, phone or interest..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          
          <div style={{ display: 'flex', gap: '12px' }}>
            <select 
              className="input" 
              style={{ width: '160px' }}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="qualified">Qualified</option>
              <option value="demo_scheduled">Demo Scheduled</option>
              <option value="converted">Converted</option>
              <option value="lost">Lost</option>
            </select>
            
            <button type="submit" className="btn btn-secondary">
              <Filter size={18} /> Filter
            </button>
          </div>
        </form>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Status</th>
                <th>Interest</th>
                <th>Source</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i}>
                    <td colSpan="6"><div className="skeleton" style={{ height: '40px', margin: '4px 0' }} /></td>
                  </tr>
                ))
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    No leads found matching your criteria.
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="avatar">{lead.full_name[0]}</div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{lead.full_name}</div>
                          <div className="text-xs text-muted">{lead.email || lead.phone}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge badge-${lead.status}`}>
                        <span className="badge-dot" style={{ background: 'currentColor' }} />
                        {lead.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td><span className="text-sm">{lead.interest || '--'}</span></td>
                    <td><span className="text-xs">{lead.source.replace('_', ' ')}</span></td>
                    <td><span className="text-xs text-muted">{new Date(lead.created_at).toLocaleDateString()}</span></td>
                    <td>
                      <div className="flex gap-2">
                        <Link to={`/leads/${lead.id}`} className="btn btn-icon btn-sm btn-secondary">
                          <MoreHorizontal size={16} />
                        </Link>
                        <button 
                          className="btn btn-icon btn-sm btn-secondary" 
                          style={{ color: 'var(--brand-primary)' }}
                          onClick={() => handleCall(lead)}
                          title={`Call ${lead.full_name}`}
                        >
                          <Phone size={16} />
                        </button>
                        <button
                          className="btn btn-icon btn-sm btn-secondary"
                          style={{ color: 'var(--brand-success)' }}
                          onClick={() => handleMessage(lead)}
                          title={`Send AI follow-up SMS to ${lead.full_name}`}
                        >
                          <MessageSquare size={16} />
                        </button>
                        <button
                          className="btn btn-icon btn-sm btn-secondary"
                          style={{ color: '#25D366' }}
                          onClick={() => handleWhatsApp(lead)}
                          title={`Send WhatsApp to ${lead.full_name}`}
                        >
                          <Send size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center mt-6">
          <div className="text-xs text-muted">
            Showing {leads.length} of {total} leads
          </div>
          <div className="flex gap-2">
            <button 
              className="btn btn-secondary btn-sm btn-icon" 
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: '13px' }}>
              Page {page} of {Math.ceil(total / 10) || 1}
            </div>
            <button 
              className="btn btn-secondary btn-sm btn-icon"
              disabled={page >= Math.ceil(total / 10)}
              onClick={() => setPage(p => p + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ── WhatsApp Quick-Send Modal ─────────────────────── */}
      {waModal.open && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 20,
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 480 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: '#25D36620', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Send size={17} style={{ color: '#25D366' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                    Send WhatsApp
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {waModal.lead?.full_name} · {waModal.lead?.phone}
                  </div>
                </div>
              </div>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
                onClick={() => setWaModal({ open: false, lead: null, message: '' })}
              >
                <X size={18} />
              </button>
            </div>

            {/* Message input */}
            <div className="input-group" style={{ marginBottom: 16 }}>
              <label className="input-label">Message</label>
              <textarea
                className="input"
                rows={5}
                style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5 }}
                value={waModal.message}
                onChange={e => setWaModal(prev => ({ ...prev, message: e.target.value }))}
                placeholder="Type your WhatsApp message..."
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
                {waModal.message.length} chars
              </div>
            </div>

            {/* Note */}
            <div style={{
              background: '#25D36610', border: '1px solid #25D36630',
              borderRadius: 8, padding: '8px 12px', marginBottom: 16, fontSize: 12, color: 'var(--text-muted)',
            }}>
              Message will be sent from <strong>{import.meta.env.VITE_WHATSAPP_NUMBER || 'your Twilio WhatsApp number'}</strong> via Twilio.
              The lead must have opted in to the WhatsApp sandbox first.
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setWaModal({ open: false, lead: null, message: '' })}
                disabled={sendingWA}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ background: '#25D366', borderColor: '#25D366' }}
                onClick={sendWhatsApp}
                disabled={sendingWA || !waModal.message.trim()}
              >
                <Send size={15} />
                {sendingWA ? 'Sending...' : 'Send WhatsApp'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <UserPlus size={18} />
                <h3 className="chart-title">Add New Lead</h3>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => { setShowAddModal(false); resetNewLead(); }}>
                Close
              </button>
            </div>

            <form className="flex-col gap-4" onSubmit={handleCreateLead}>
              <div className="input-group">
                <label className="input-label">Full Name *</label>
                <input
                  className="input"
                  value={newLead.full_name}
                  onChange={(e) => setNewLead((prev) => ({ ...prev, full_name: e.target.value }))}
                  required
                />
              </div>

              <div className="charts-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="input-group">
                  <label className="input-label">Phone *</label>
                  <input
                    className="input"
                    placeholder="+9199..."
                    value={newLead.phone}
                    onChange={(e) => setNewLead((prev) => ({ ...prev, phone: e.target.value }))}
                    required
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Email</label>
                  <input
                    className="input"
                    type="email"
                    value={newLead.email}
                    onChange={(e) => setNewLead((prev) => ({ ...prev, email: e.target.value }))}
                  />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Interest</label>
                <input
                  className="input"
                  value={newLead.interest}
                  onChange={(e) => setNewLead((prev) => ({ ...prev, interest: e.target.value }))}
                />
              </div>

              <div className="charts-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="input-group">
                  <label className="input-label">Source</label>
                  <select
                    className="input"
                    value={newLead.source}
                    onChange={(e) => setNewLead((prev) => ({ ...prev, source: e.target.value }))}
                  >
                    <option value="manual">Manual</option>
                    <option value="web_form">Web Form</option>
                    <option value="social_media">Social Media</option>
                    <option value="inbound_call">Inbound Call</option>
                    <option value="outbound_call">Outbound Call</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="sms">SMS</option>
                    <option value="referral">Referral</option>
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">Lead Type</label>
                  <select
                    className="input"
                    value={newLead.lead_type}
                    onChange={(e) => setNewLead((prev) => ({ ...prev, lead_type: e.target.value }))}
                  >
                    <option value="form">Form</option>
                    <option value="call">Call</option>
                    <option value="dm">DM</option>
                  </select>
                </div>
              </div>

              <div className="charts-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="input-group">
                  <label className="input-label">Job Role</label>
                  <input
                    className="input"
                    value={newLead.job_role}
                    onChange={(e) => setNewLead((prev) => ({ ...prev, job_role: e.target.value }))}
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Years Experience</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.1"
                    value={newLead.years_experience}
                    onChange={(e) => setNewLead((prev) => ({ ...prev, years_experience: e.target.value }))}
                  />
                </div>
              </div>

              <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowAddModal(false); resetNewLead(); }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingLead}>
                  {savingLead ? 'Saving...' : 'Save Lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
