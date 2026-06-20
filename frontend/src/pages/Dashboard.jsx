import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Eye, Sparkles, Trophy, DollarSign, Ticket,
  RefreshCw, ArrowRight, Brain, Clock, Calendar
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar
} from 'recharts';
import {
  adminAPI, leadsAPI, analyticsAPI, customersAPI,
  ticketsAPI, visitorsAPI, aiTrainingAPI,
} from '../lib/api';
import { toast } from 'react-hot-toast';

function KPI({ label, value, subtitle, icon, color, bgColor }) {
  return (
    <div className="premium-kpi-card">
      <div className="kpi-header">
        <span className="kpi-title">{label}</span>
        <div className="kpi-icon-container" style={{ background: bgColor, color }}>
          {icon}
        </div>
      </div>
      <div className="kpi-content">
        <span className="kpi-value">{value}</span>
        <span className="kpi-trend" style={{ color: 'var(--text-4)' }}>{subtitle}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [recentLeads, setRecentLeads] = useState([]);
  const [overview, setOverview] = useState(null);
  const [funnel, setFunnel] = useState([]);
  const [customerStats, setCustomerStats] = useState(null);
  const [ticketStats, setTicketStats] = useState(null);
  const [ticketItems, setTicketItems] = useState([]);
  const [activeVisitors, setActiveVisitors] = useState(0);
  const [trainingDocs, setTrainingDocs] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const [
        statsRes,
        activityRes,
        leadsRes,
        overviewRes,
        funnelRes,
        customersStatsRes,
        ticketsStatsRes,
        ticketsListRes,
        visitorsRes,
        docsRes,
      ] = await Promise.allSettled([
        adminAPI.dashboardStats(),
        adminAPI.dashboardActivity(14),
        leadsAPI.list({ page: 1, page_size: 8 }),
        analyticsAPI.overview(),
        analyticsAPI.funnel(),
        customersAPI.stats(),
        ticketsAPI.stats(),
        ticketsAPI.list({ page: 1, page_size: 5 }),
        visitorsAPI.list({ active_only: true }),
        aiTrainingAPI.documents.list(),
      ]);

      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data);
      if (activityRes.status === 'fulfilled') {
        const items = activityRes.value.data?.items || [];
        setActivity(items.map((p) => ({ ...p, label: new Date(p.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) })));
      }
      if (leadsRes.status === 'fulfilled') setRecentLeads(leadsRes.value.data?.items || []);
      if (overviewRes.status === 'fulfilled') setOverview(overviewRes.value.data || {});
      if (funnelRes.status === 'fulfilled') setFunnel(funnelRes.value.data?.funnel || []);
      if (customersStatsRes.status === 'fulfilled') setCustomerStats(customersStatsRes.value.data || {});
      if (ticketsStatsRes.status === 'fulfilled') setTicketStats(ticketsStatsRes.value.data || {});
      if (ticketsListRes.status === 'fulfilled') setTicketItems(ticketsListRes.value.data?.items || []);
      if (visitorsRes.status === 'fulfilled') {
        const sessions = visitorsRes.value.data?.sessions || visitorsRes.value.data?.items || [];
        setActiveVisitors(sessions.filter((s) => s.is_active).length);
      }
      if (docsRes.status === 'fulfilled') {
        const payload = docsRes.value.data;
        const docs = Array.isArray(payload) ? payload : (payload?.documents || payload?.items || []);
        setTrainingDocs(Array.isArray(docs) ? docs : []);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const convertedCount = useMemo(() => {
    const stage = (funnel || []).find((f) => (f.stage || '').toLowerCase() === 'converted');
    return stage?.count || 0;
  }, [funnel]);

  const customerRows = useMemo(() => recentLeads.filter((l) => l.status === 'converted').slice(0, 5), [recentLeads]);

  if (loading) {
    return (
      <div className="flex-col gap-6">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="skeleton" style={{ height: 108, borderRadius: 12 }} />)}
        </div>
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    );
  }

  return (
    <div className="dashboard-content-layout">
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 18, fontWeight: 800 }}>Business Dashboard</h1>
          <p className="page-subtitle" style={{ fontSize: 12 }}>Live CRM metrics across leads, customers, tickets, visitors, and AI training.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="kpi-row-grid">
        <KPI label="Total Leads" value={stats?.total_leads ?? 0} subtitle="All time" icon={<Users size={16} />} color="#2563eb" bgColor="rgba(37,99,235,0.08)" />
        <KPI label="Visitors" value={activeVisitors} subtitle="Active sessions" icon={<Eye size={16} />} color="#7c3aed" bgColor="rgba(124,58,237,0.08)" />
        <KPI label="AI Qualified" value={stats?.leads_by_status?.qualified ?? 0} subtitle="Qualified leads" icon={<Sparkles size={16} />} color="#10b981" bgColor="rgba(16,185,129,0.08)" />
        <KPI label="Conversions" value={convertedCount} subtitle="Converted leads" icon={<Trophy size={16} />} color="#f97316" bgColor="rgba(249,115,22,0.08)" />
        <KPI label="Revenue" value={overview?.total_revenue || 'INR 0'} subtitle="Projected" icon={<DollarSign size={16} />} color="#ec4899" bgColor="rgba(236,72,153,0.08)" />
        <KPI label="Customers" value={customerStats?.active_contracts ?? customerRows.length} subtitle="Active contracts" icon={<Users size={16} />} color="#06b6d4" bgColor="rgba(6,182,212,0.08)" />
      </div>

      <div className="dashboard-row-3col">
        <div className="card">
          <h2 className="chart-title" style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Lead & Call Activity</h2>
          <div style={{ width: '100%', height: 180 }}>
            <ResponsiveContainer>
              <AreaChart data={activity} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="dashCalls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" fontSize={10} />
                <YAxis fontSize={10} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="leads" stroke="#2563eb" fillOpacity={1} fill="url(#dashLeads)" strokeWidth={1.5} />
                <Area type="monotone" dataKey="calls" stroke="#0ea5e9" fillOpacity={1} fill="url(#dashCalls)" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h2 className="chart-title" style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Conversion Funnel</h2>
          <div style={{ width: '100%', height: 180 }}>
            <ResponsiveContainer>
              <BarChart data={funnel} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="stage" width={90} fontSize={10} />
                <Tooltip />
                <Bar dataKey="count" fill="#7c3aed" radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 className="chart-title" style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Customer Tickets</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div className="premium-kpi-card" style={{ padding: 8 }}>
              <div className="kpi-title">Open</div>
              <div className="kpi-value" style={{ fontSize: 18 }}>{ticketStats?.active ?? 0}</div>
            </div>
            <div className="premium-kpi-card" style={{ padding: 8 }}>
              <div className="kpi-title">SLA Breached</div>
              <div className="kpi-value" style={{ fontSize: 18, color: '#ef4444' }}>{ticketStats?.sla_breached ?? 0}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ticketItems.slice(0, 3).map((t) => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                <span style={{ color: 'var(--text-2)' }}>{t.subject}</span>
                <span style={{ fontWeight: 600 }}>{t.status}</span>
              </div>
            ))}
            {ticketItems.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-4)' }}>No ticket activity yet.</div>}
          </div>
        </div>
      </div>

      <div className="dashboard-row-3col">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <h2 className="chart-title" style={{ fontSize: 13, fontWeight: 700, marginBottom: 0 }}>Recent Customers</h2>
            <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: 10.5 }} onClick={() => navigate('/customers')}>View All</button>
          </div>
          <table className="data-table" style={{ fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th>Customer</th>
                <th>Phone</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {customerRows.slice(0, 5).map((c) => (
                <tr key={c.id}>
                  <td>{c.full_name}</td>
                  <td>{c.phone || '--'}</td>
                  <td><span className="badge badge-converted">Converted</span></td>
                </tr>
              ))}
              {customerRows.length === 0 && (
                <tr><td colSpan="3" style={{ textAlign: 'center', padding: 14, color: 'var(--text-4)' }}>No converted customers yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Brain size={16} style={{ color: '#2563eb' }} />
            <h2 className="chart-title" style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>AI Training Module</h2>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-4)', margin: '0 0 8px' }}>Knowledge base documents and model readiness.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div className="premium-kpi-card" style={{ padding: 8 }}>
              <div className="kpi-title">Documents</div>
              <div className="kpi-value" style={{ fontSize: 18 }}>{trainingDocs.length}</div>
            </div>
            <div className="premium-kpi-card" style={{ padding: 8 }}>
              <div className="kpi-title">Trained</div>
              <div className="kpi-value" style={{ fontSize: 18 }}>{trainingDocs.filter((d) => d.status === 'trained').length}</div>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/ai-training')}>
            Open AI Training <ArrowRight size={11} />
          </button>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 className="chart-title" style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Recent Activities</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentLeads.slice(0, 4).map((lead) => (
              <div key={lead.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{lead.full_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{lead.status} • {new Date(lead.created_at).toLocaleDateString()}</div>
              </div>
            ))}
            {recentLeads.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-4)' }}>No recent activities available.</div>}
          </div>
          <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingTop: 8 }}>
            <div className="premium-kpi-card" style={{ padding: 8 }}>
              <div className="kpi-title">Follow-Ups Due</div>
              <div className="kpi-value" style={{ fontSize: 16 }}>{stats?.pending_follow_ups ?? 0}</div>
            </div>
            <div className="premium-kpi-card" style={{ padding: 8 }}>
              <div className="kpi-title">Notifications</div>
              <div className="kpi-value" style={{ fontSize: 16 }}>{stats?.notifications_today ?? 0}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="status-blocks-row">
        <div className="status-block-card"><Ticket size={12} /><span>Open Tickets</span><strong>{ticketStats?.active ?? 0}</strong></div>
        <div className="status-block-card"><Clock size={12} /><span>Avg Call Duration</span><strong>{stats?.avg_call_duration_seconds ?? 0}s</strong></div>
        <div className="status-block-card"><Calendar size={12} /><span>Calls Today</span><strong>{stats?.total_calls_today ?? 0}</strong></div>
        <div className="status-block-card"><Users size={12} /><span>New Leads Today</span><strong>{stats?.new_leads_today ?? 0}</strong></div>
      </div>
    </div>
  );
}
