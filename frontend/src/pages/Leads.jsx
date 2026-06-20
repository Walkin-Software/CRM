import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Filter, Plus, MoreHorizontal, Phone, MessageSquare, Send,
  Download, Upload, ChevronLeft, ChevronRight, X, Mail, Star, ExternalLink,
  Users, Eye, Trophy, DollarSign, Calendar, Flame, UserCheck, HelpCircle,
  ChevronDown, LayoutGrid
} from 'lucide-react';
import { leadsAPI, callsAPI, notificationsAPI, api } from '../lib/api';
import { toast } from 'react-hot-toast';
import { PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area } from 'recharts';

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

  // Redesign Right Details Panel States
  const [selectedLead, setSelectedLead] = useState(null);
  const [rightPanelTab, setRightPanelTab] = useState('Overview');

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
      const items = res.data.items || [];
      setLeads(items);
      setTotal(res.data.total);

      // Default selection on load
      if (items.length > 0 && !selectedLead) {
        setSelectedLead(items[0]);
      }
    } catch (err) {
      toast.error('Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, [page, status]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchLeads();
  };

  const handleCall = async (lead) => {
    if (!lead) return;
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
    if (!lead) return;
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

  const handleWhatsApp = (lead) => {
    if (!lead) return;
    if (!lead.phone) { toast.error('Lead has no phone number'); return; }
    const firstName = lead.full_name?.split(' ')[0] || 'there';
    setWaModal({
      open: true,
      lead,
      message: `Hi ${firstName}! 👋 This is a message from CRM Calling AI. We noticed your interest in our courses. Would you like to know more or schedule a free demo call?`,
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

      const headers = ['ID', 'Name', 'Phone', 'Email', 'Interest', 'Status', 'Source', 'Lead Type', 'Job Role', 'Years Experience', 'Created At'];
      const csvLines = [headers.join(',')];
      rows.forEach((lead) => {
        csvLines.push([
          lead.id,
          `"${lead.full_name?.replace(/"/g, '""') || ''}"`,
          lead.phone || '',
          lead.email || '',
          `"${lead.interest?.replace(/"/g, '""') || ''}"`,
          lead.status || '',
          lead.source || '',
          lead.lead_type || '',
          `"${lead.job_role?.replace(/"/g, '""') || ''}"`,
          lead.years_experience || '',
          lead.created_at || '',
        ].join(','));
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

  // Dynamic KPI + chart data from loaded leads
  const statusCounts = leads.reduce((acc, l) => {
    const key = (l.status || 'new').toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const sourceData = Object.entries(
    leads.reduce((acc, l) => {
      const key = (l.source || 'unknown').replace('_', ' ');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));
  const convertedCount = statusCounts.converted || 0;
  const conversionRate = total > 0 ? `${((convertedCount / total) * 100).toFixed(1)}%` : '0%';

  const kpis = [
    { label: 'Total Leads', value: total, color: '#2563eb', bg: 'rgba(37,99,235,0.08)', sparkData: [30, 45, 35, 60, 40, 75, 90] },
    { label: 'New Leads', value: statusCounts.new || 0, color: '#7c3aed', bg: 'rgba(124,58,237,0.08)', sparkData: [50, 40, 65, 55, 80, 70, 95] },
    { label: 'Qualified Leads', value: statusCounts.qualified || 0, color: '#10b981', bg: 'rgba(16,185,129,0.08)', sparkData: [20, 30, 25, 45, 35, 50, 60] },
    { label: 'Unqualified Leads', value: statusCounts.lost || 0, color: '#ef4444', bg: 'rgba(239,68,68,0.08)', sparkData: [40, 30, 35, 28, 45, 32, 25] },
    { label: 'Converted Leads', value: convertedCount, color: '#06b6d4', bg: 'rgba(6,182,212,0.08)', sparkData: [10, 15, 12, 22, 18, 25, 30] },
    { label: 'Conversion Rate', value: conversionRate, color: '#f97316', bg: 'rgba(249,115,22,0.08)', sparkData: [15, 20, 18, 28, 24, 32, 38] },
  ];

  // Render detail profile values dynamically
  const activeDetailLead = selectedLead || (leads.length > 0 ? leads[0] : null);
  const activeLeadScore = activeDetailLead ? (Math.abs(parseInt(activeDetailLead.id?.replace(/[^0-9]/g, '')) || 75) % 25 + 71) : 95;

  return (
    <div className="flex-col gap-6">
      {/* ── Page Header ── */}
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div>
          <h2 className="page-title" style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-1)' }}>Leads</h2>
          <p className="page-subtitle" style={{ fontSize: '12px', color: 'var(--text-3)' }}>Manage, track and convert your leads into customers.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={handleImportCSV}
          />
          <button className="btn btn-secondary btn-sm" style={{ display: 'flex', gap: 4, fontWeight: 600 }} onClick={() => csvInputRef.current?.click()} disabled={importing}>
            <Upload size={13} /> {importing ? 'Importing...' : 'Import'}
          </button>
          <button className="btn btn-secondary btn-sm" style={{ display: 'flex', gap: 4, fontWeight: 600 }} onClick={handleExport} disabled={exporting}>
            <Download size={13} /> Export
          </button>
          <button className="btn btn-primary btn-sm" style={{ display: 'flex', gap: 4, fontWeight: 600, background: '#2563eb', border: 'none', color: 'white' }} onClick={() => setShowAddModal(true)}>
            <Plus size={13} /> Add Lead
          </button>
        </div>
      </div>

      {/* ── Row 1: Top Metrics ── */}
      <div className="kpi-row-grid">
        {kpis.map((k) => (
          <div key={k.label} className="premium-kpi-card">
            <div className="kpi-header">
              <span className="kpi-title">{k.label}</span>
              <div className="kpi-icon-container" style={{ background: k.bg, color: k.color }}>
                <Users size={15} />
              </div>
            </div>
            <div className="kpi-content">
              <span className="kpi-value" style={{ fontSize: typeof k.value === 'string' && k.value.includes('%') ? '16px' : '22px' }}>{k.value}</span>
              <span className="kpi-trend" style={{ color: 'var(--success)' }}>Live</span>
            </div>
            {k.label === 'Total Leads' && (
              <div className="kpi-sparkline">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={k.sparkData.map((val, idx) => ({ id: idx, val }))} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`leadsSpark-${k.color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={k.color} stopOpacity={0.15} />
                        <stop offset="100%" stopColor={k.color} stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="val" stroke={k.color} strokeWidth={1.5} fill={`url(#leadsSpark-${k.color.replace('#','')})`} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Helper component for sparklines */}
      <style>{`
        .kpi-sparkline { position: absolute; bottom: 0; left: 0; right: 0; height: 32px; width: 100%; pointer-events: none; }
      `}</style>

      {/* ── Row 2: Split 3-Pane Layout ── */}
      <div className="split-layout-pane">
        {/* Main/Center Content Pane */}
        <div className="main-pane-content">
          {/* Pipeline flow & source Donut Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '58% 42%', gap: 16 }}>
            {/* Pipeline Stage Card */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="chart-title" style={{ fontSize: '13px', fontWeight: '700', margin: 0 }}>Lead Pipeline</h3>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, height: '140px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-hover)', marginTop: '14px', padding: 10 }}>
                {[
                  ['New', statusCounts.new || 0, '#7c3aed'],
                  ['Contacted', statusCounts.contacted || 0, '#2563eb'],
                  ['Qualified', statusCounts.qualified || 0, '#10b981'],
                  ['Converted', convertedCount, '#06b6d4'],
                ].map(([label, count, color]) => {
                  const width = total ? Math.max(6, Math.round((count / total) * 100)) : 0;
                  return (
                    <div key={label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                        <span style={{ color: 'var(--text-3)' }}>{label}</span>
                        <span style={{ fontWeight: 700 }}>{count}</span>
                      </div>
                      <div style={{ width: '100%', height: 6, background: 'rgba(148,163,184,0.25)', borderRadius: 999 }}>
                        <div style={{ width: `${width}%`, height: '100%', background: color, borderRadius: 999 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Source Donut Card */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <h3 className="chart-title" style={{ fontSize: '13px', fontWeight: '700', marginBottom: 12 }}>Leads by Source</h3>
              <div style={{ flex: 1, height: '140px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-hover)' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={sourceData} dataKey="value" nameKey="name" innerRadius={30} outerRadius={52}>
                      {sourceData.map((_, i) => <Cell key={i} fill={['#2563eb', '#7c3aed', '#10b981', '#f97316', '#ef4444', '#06b6d4'][i % 6]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Leads Table Card */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <h3 className="chart-title" style={{ margin: 0, fontSize: '13.5px', fontWeight: 700 }}>All Leads</h3>
                <span className="badge badge-contacted">{total} total</span>
              </div>

              {/* Filtering / Search */}
              <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="search-container" style={{ width: 180 }}>
                  <Search className="input-icon" size={13} style={{ left: 8 }} />
                  <input
                    type="text"
                    placeholder="Search leads..."
                    className="input"
                    style={{ paddingLeft: '26px', paddingRight: '8px', fontSize: '11.5px', padding: '4px 8px 4px 26px', borderRadius: '4px' }}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select 
                  className="input" 
                  style={{ width: '110px', fontSize: '11px', padding: '4px 6px', height: '26px', borderRadius: '4px' }}
                  value={status}
                  onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                >
                  <option value="">All Statuses</option>
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                  <option value="qualified">Qualified</option>
                  <option value="demo_scheduled">Demo Scheduled</option>
                  <option value="converted">Converted</option>
                  <option value="lost">Lost</option>
                </select>
                <button type="submit" className="btn btn-secondary btn-sm" style={{ padding: '4px 8px' }}>
                  Filter
                </button>
              </form>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th>Lead</th>
                    <th>Source</th>
                    <th>Company</th>
                    <th>Status</th>
                    <th>Owner</th>
                    <th>Added On</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array(5).fill(0).map((_, i) => (
                      <tr key={i}>
                        <td colSpan="7"><div className="skeleton" style={{ height: '32px', margin: '4px 0' }} /></td>
                      </tr>
                    ))
                  ) : leads.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', padding: '36px', color: 'var(--text-4)' }}>No leads found matching criteria.</td>
                    </tr>
                  ) : (
                    leads.map((lead) => {
                      const isActive = activeDetailLead?.id === lead.id;
                      return (
                        <tr 
                          key={lead.id} 
                          style={{ cursor: 'pointer', background: isActive ? 'rgba(37,99,235,0.03)' : 'none' }}
                          onClick={() => setSelectedLead(lead)}
                        >
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div className="avatar" style={{ width: 26, height: 26, fontSize: 10, background: 'var(--primary)' }}>
                                {lead.full_name?.[0]?.toUpperCase() || '?'}
                              </div>
                              <div>
                                <div style={{ fontWeight: 700, color: 'var(--text-1)' }}>{lead.full_name}</div>
                                <div style={{ fontSize: '10px', color: 'var(--text-4)' }}>{lead.phone || '--'}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ textTransform: 'capitalize' }}>{lead.source?.replace('_', ' ')}</td>
                          <td>{lead.job_role || 'TechNova Solutions'}</td>
                          <td>
                            <span className={`badge badge-${lead.status}`}>
                              {lead.status?.replace('_', ' ')}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=100&q=80" alt="Owner" style={{ width: 16, height: 16, borderRadius: '50%' }} />
                              <span style={{ fontSize: '10.5px', color: 'var(--text-3)' }}>Admin</span>
                            </div>
                          </td>
                          <td style={{ color: 'var(--text-4)' }}>{new Date(lead.created_at || Date.now()).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</td>
                          <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'inline-flex', gap: 4 }}>
                              <button className="btn-icon" style={{ padding: 4 }} onClick={() => handleWhatsApp(lead)} title="WhatsApp">
                                <Send size={12} style={{ color: '#25D366' }} />
                              </button>
                              <button className="btn-icon" style={{ padding: 4 }} onClick={() => handleCall(lead)} title="Call">
                                <Phone size={12} style={{ color: 'var(--primary)' }} />
                              </button>
                              <button className="btn-icon" style={{ padding: 4 }} onClick={() => handleMessage(lead)} title="SMS">
                                <MessageSquare size={12} style={{ color: 'var(--success)' }} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-4)' }}>
                Showing {leads.length} of {total} leads
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" style={{ padding: 4 }} disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft size={13} />
                </button>
                <span style={{ fontSize: '11.5px', color: 'var(--text-2)' }}>Page {page} of {Math.ceil(total / 10) || 1}</span>
                <button className="btn btn-secondary btn-sm" style={{ padding: 4 }} disabled={page >= Math.ceil(total / 10)} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Details Panel */}
        <div className="details-pane-container">
          {activeDetailLead ? (
            <>
              {/* Header profile block */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="avatar" style={{ width: 34, height: 34, fontSize: 13, background: '#eff6ff', color: '#2563eb', fontWeight: '700' }}>
                    {activeDetailLead.full_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <h3 style={{ margin: 0 }}>{activeDetailLead.full_name}</h3>
                    <div style={{ fontSize: '10px', color: 'var(--text-4)', fontWeight: '500' }}>{activeDetailLead.job_role || 'Sales Prospect'}</div>
                  </div>
                </div>

                {/* Score Indicator */}
                <div style={{ textAlign: 'center', border: '1px solid var(--border)', padding: '2px 6px', borderRadius: '6px', background: '#f8fafc' }}>
                  <div style={{ fontSize: '11px', fontWeight: '800', color: 'var(--success)' }}>{activeLeadScore}</div>
                  <div style={{ fontSize: '6.5px', color: 'var(--text-4)', textTransform: 'uppercase', fontWeight: 600 }}>AI Score</div>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, margin: '4px 0' }}>
                <button className="btn btn-secondary" style={{ padding: '6px 0', justifyContent: 'center', flexDirection: 'column', height: 'auto', gap: 4 }} onClick={() => handleCall(activeDetailLead)}>
                  <Phone size={13} style={{ color: 'var(--primary)' }} />
                  <span style={{ fontSize: '9.5px', fontWeight: 600 }}>Call</span>
                </button>
                <button className="btn btn-secondary" style={{ padding: '6px 0', justifyContent: 'center', flexDirection: 'column', height: 'auto', gap: 4 }} onClick={() => handleWhatsApp(activeDetailLead)}>
                  <Send size={13} style={{ color: '#25D366' }} />
                  <span style={{ fontSize: '9.5px', fontWeight: 600 }}>WhatsApp</span>
                </button>
                <button className="btn btn-secondary" style={{ padding: '6px 0', justifyContent: 'center', flexDirection: 'column', height: 'auto', gap: 4 }} onClick={() => handleMessage(activeDetailLead)}>
                  <Mail size={13} style={{ color: 'var(--success)' }} />
                  <span style={{ fontSize: '9.5px', fontWeight: 600 }}>Email</span>
                </button>
                <button className="btn btn-secondary" style={{ padding: '6px 0', justifyContent: 'center', flexDirection: 'column', height: 'auto', gap: 4 }} onClick={() => toast.success('Note logging session opened!')}>
                  <MoreHorizontal size={13} style={{ color: 'var(--text-4)' }} />
                  <span style={{ fontSize: '9.5px', fontWeight: 600 }}>More</span>
                </button>
              </div>

              {/* Panel Tabs */}
              <div className="details-pane-tabs">
                {['Overview', 'Activity', 'AI Insights', 'Notes'].map((t) => (
                  <button 
                    key={t} 
                    className={`details-pane-tab ${rightPanelTab === t ? 'active' : ''}`}
                    onClick={() => setRightPanelTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Dynamic Panel Content */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, fontSize: '12px' }}>
                {rightPanelTab === 'Overview' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--bg-hover)' }}>
                      <span style={{ color: 'var(--text-4)' }}>Email</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{activeDetailLead.email || '--'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--bg-hover)' }}>
                      <span style={{ color: 'var(--text-4)' }}>Phone</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{activeDetailLead.phone || '--'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--bg-hover)' }}>
                      <span style={{ color: 'var(--text-4)' }}>Company</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{activeDetailLead.company || 'TechNova Solutions'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--bg-hover)' }}>
                      <span style={{ color: 'var(--text-4)' }}>Source</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-1)', textTransform: 'capitalize' }}>{activeDetailLead.source || '--'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--bg-hover)' }}>
                      <span style={{ color: 'var(--text-4)' }}>Status</span>
                      <span className={`badge badge-${activeDetailLead.status}`} style={{ height: 'fit-content' }}>{activeDetailLead.status}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--bg-hover)' }}>
                      <span style={{ color: 'var(--text-4)' }}>Lead Value</span>
                      <span style={{ fontWeight: 700, color: 'var(--text-4)', fontSize: '11.5px' }}>{`INR ${(activeLeadScore * 1200).toLocaleString()}`}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6 }}>
                      <span style={{ color: 'var(--text-4)' }}>Created On</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{new Date(activeDetailLead.created_at || Date.now()).toLocaleDateString()}</span>
                    </div>
                  </div>
                )}
 
                {rightPanelTab === 'Activity' && (
                  <div style={{ color: 'var(--text-3)', fontSize: '11.5px', minHeight: '100px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-hover)', padding: 10, lineHeight: 1.5 }}>
                    <div><strong>Created:</strong> {new Date(activeDetailLead.created_at || Date.now()).toLocaleString()}</div>
                    <div><strong>Source:</strong> {(activeDetailLead.source || '--').replace('_', ' ')}</div>
                    <div><strong>Status:</strong> {(activeDetailLead.status || '--').replace('_', ' ')}</div>
                    <div><strong>Last Action:</strong> {activeLeadScore >= 70 ? 'AI qualification complete' : 'Needs follow-up call'}</div>
                  </div>
                )}
 
                {rightPanelTab === 'AI Insights' && (
                  <div style={{ color: 'var(--text-3)', fontSize: '11.5px', minHeight: '100px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-hover)', padding: 10, lineHeight: 1.5 }}>
                    <div><strong>Lead Score:</strong> {activeLeadScore}/100</div>
                    <div><strong>Temperature:</strong> {activeLeadScore >= 80 ? 'Hot' : activeLeadScore >= 60 ? 'Warm' : 'Cold'}</div>
                    <div><strong>Suggested CTA:</strong> {activeLeadScore >= 80 ? 'Schedule demo call within 24h' : 'Send WhatsApp intro and qualify interest'}</div>
                  </div>
                )}
 
                {rightPanelTab === 'Notes' && (
                  <div style={{ color: 'var(--text-3)', fontSize: '11.5px', minHeight: '100px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-hover)', padding: 10, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {activeDetailLead.description || activeDetailLead.interest || 'No manual notes yet. Use call, WhatsApp, or Email actions to enrich this lead profile.'}
                  </div>
                )}
              </div>
 
              {/* Next Best Action Footer Block */}
              <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ background: '#f0fdf4', border: '1px solid rgba(22, 163, 74, 0.2)', borderRadius: '8px', padding: '10px' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <Flame size={14} style={{ color: '#16a34a', flexShrink: 0, marginTop: 1 }} />
                    <div style={{ fontSize: '11px', lineHeight: 1.4, color: '#166534' }}>
                      <strong>Next Best Action:</strong> {activeLeadScore >= 80 ? 'Book a demo call and send payment link.' : 'Send qualification WhatsApp and schedule follow-up.'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button className="btn btn-primary btn-sm" style={{ background: '#16a34a', border: 'none', color: 'white', flex: 1, padding: '4px', fontSize: '10.5px' }} onClick={() => handleCall(activeDetailLead)}>
                      Schedule Call
                    </button>
                    <button className="btn btn-secondary btn-sm" style={{ background: 'white', flex: 1, padding: '4px', fontSize: '10.5px' }} onClick={() => handleWhatsApp(activeDetailLead)}>
                      Send WhatsApp
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-4)' }}>Select a lead to examine details.</div>
          )}
        </div>
      </div>

      {/* ── WhatsApp Quick-Send Modal ── */}
      {waModal.open && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 20,
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 420 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#25D36620', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Send size={15} style={{ color: '#25D366' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>Send WhatsApp</div>
                  <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{waModal.lead?.full_name}</div>
                </div>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', padding: 4 }} onClick={() => setWaModal({ open: false, lead: null, message: '' })}>
                <X size={18} />
              </button>
            </div>

            <div className="input-group" style={{ marginBottom: 12 }}>
              <label className="input-label">Message Template</label>
              <textarea
                className="input"
                rows={4}
                style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.45 }}
                value={waModal.message}
                onChange={e => setWaModal(prev => ({ ...prev, message: e.target.value }))}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setWaModal({ open: false, lead: null, message: '' })} disabled={sendingWA}>Cancel</button>
              <button className="btn btn-primary btn-sm" style={{ background: '#25D366', borderColor: '#25D366', color: 'white' }} onClick={sendWhatsApp} disabled={sendingWA || !waModal.message.trim()}>
                {sendingWA ? 'Sending...' : 'Send WhatsApp'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Lead Modal ── */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div className="card" style={{ width: '100%', maxWidth: '580px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="chart-title">Add New Lead</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => { setShowAddModal(false); resetNewLead(); }}>Close</button>
            </div>

            <form className="flex-col gap-4" onSubmit={handleCreateLead}>
              <div className="input-group">
                <label className="input-label">Full Name *</label>
                <input className="input" value={newLead.full_name} onChange={(e) => setNewLead(prev => ({ ...prev, full_name: e.target.value }))} required />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="input-group">
                  <label className="input-label">Phone *</label>
                  <input className="input" placeholder="+91..." value={newLead.phone} onChange={(e) => setNewLead(prev => ({ ...prev, phone: e.target.value }))} required />
                </div>
                <div className="input-group">
                  <label className="input-label">Email</label>
                  <input className="input" type="email" value={newLead.email} onChange={(e) => setNewLead(prev => ({ ...prev, email: e.target.value }))} />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Interest</label>
                <input className="input" value={newLead.interest} onChange={(e) => setNewLead(prev => ({ ...prev, interest: e.target.value }))} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="input-group">
                  <label className="input-label">Source</label>
                  <select className="input" value={newLead.source} onChange={(e) => setNewLead(prev => ({ ...prev, source: e.target.value }))}>
                    <option value="manual">Manual</option>
                    <option value="web_form">Web Form</option>
                    <option value="social_media">Social Media</option>
                    <option value="inbound_call">Inbound Call</option>
                    <option value="outbound_call">Outbound Call</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="referral">Referral</option>
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">Lead Type</label>
                  <select className="input" value={newLead.lead_type} onChange={(e) => setNewLead(prev => ({ ...prev, lead_type: e.target.value }))}>
                    <option value="form">Form</option>
                    <option value="call">Call</option>
                    <option value="dm">DM</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="input-group">
                  <label className="input-label">Job Role</label>
                  <input className="input" value={newLead.job_role} onChange={(e) => setNewLead(prev => ({ ...prev, job_role: e.target.value }))} />
                </div>
                <div className="input-group">
                  <label className="input-label">Years Experience</label>
                  <input className="input" type="number" min="0" value={newLead.years_experience} onChange={(e) => setNewLead(prev => ({ ...prev, years_experience: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setShowAddModal(false); resetNewLead(); }}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={savingLead}>{savingLead ? 'Saving...' : 'Save Lead'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
