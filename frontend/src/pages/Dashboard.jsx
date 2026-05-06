import { useEffect, useState } from 'react';
import { 
  Users, Phone, TrendingUp, Clock, MessageSquare, Mail,
  ArrowUpRight
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar, Cell 
} from 'recharts';
import { leadsAPI, callsAPI, notificationsAPI } from '../lib/api';
import { toast } from 'react-hot-toast';

const COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'];

function toDate(value) {
  return value ? new Date(value) : null;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function daysAgoDate(daysAgo) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function formatRelativeTime(value) {
  const d = toDate(value);
  if (!d) return '--';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day ago`;
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [dailyData, setDailyData] = useState([]);
  const [statusData, setStatusData] = useState([]);
  const [recentLeads, setRecentLeads] = useState([]);
  const [recentDispatches, setRecentDispatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAllWithPagination(apiListMethod) {
      const pageSize = 100;
      let page = 1;
      const all = [];

      while (true) {
        const res = await apiListMethod({ page, page_size: pageSize });
        const items = res.data?.items || [];
        all.push(...items);
        if (items.length < pageSize) break;
        page += 1;
        if (page > 100) break;
      }

      return all;
    }

    async function fetchData() {
      try {
        const [leads, calls] = await Promise.all([
          fetchAllWithPagination(leadsAPI.list),
          fetchAllWithPagination(callsAPI.list),
        ]);

        try {
          const historyRes = await notificationsAPI.history({ page: 1, page_size: 6 });
          setRecentDispatches(historyRes.data?.items || []);
        } catch {
          setRecentDispatches([]);
        }

        const today = new Date();
        const callsToday = calls.filter((c) => {
          const dt = toDate(c.created_at);
          return dt ? isSameDay(dt, today) : false;
        }).length;

        const converted = leads.filter((l) => l.status === 'converted').length;
        const conversionRate = leads.length ? Number(((converted / leads.length) * 100).toFixed(2)) : 0;

        const answeredCalls = calls.filter(
          (c) => (c.status === 'answered' || c.status === 'completed') && Number(c.duration_seconds || 0) > 0
        );
        const avgCallDurationSeconds = answeredCalls.length
          ? Number((answeredCalls.reduce((acc, c) => acc + Number(c.duration_seconds || 0), 0) / answeredCalls.length).toFixed(1))
          : 0;

        const current7Start = daysAgoDate(6);
        const previous7Start = daysAgoDate(13);
        const previous7End = daysAgoDate(7);

        const current7Leads = leads.filter((l) => {
          const dt = toDate(l.created_at);
          return dt && dt >= current7Start;
        }).length;
        const previous7Leads = leads.filter((l) => {
          const dt = toDate(l.created_at);
          return dt && dt >= previous7Start && dt < previous7End;
        }).length;

        const current7Calls = calls.filter((c) => {
          const dt = toDate(c.created_at);
          return dt && dt >= current7Start;
        }).length;
        const previous7Calls = calls.filter((c) => {
          const dt = toDate(c.created_at);
          return dt && dt >= previous7Start && dt < previous7End;
        }).length;

        const leadsDeltaPct = previous7Leads > 0
          ? Number((((current7Leads - previous7Leads) / previous7Leads) * 100).toFixed(1))
          : (current7Leads > 0 ? 100 : 0);

        const callsDeltaPct = previous7Calls > 0
          ? Number((((current7Calls - previous7Calls) / previous7Calls) * 100).toFixed(1))
          : (current7Calls > 0 ? 100 : 0);

        setStats({
          total_leads: leads.length,
          total_calls_today: callsToday,
          conversion_rate: conversionRate,
          avg_call_duration_seconds: avgCallDurationSeconds,
          leads_delta_pct: leadsDeltaPct,
          calls_delta_pct: callsDeltaPct,
        });

        const dayPoints = [];
        for (let i = 13; i >= 0; i -= 1) {
          const day = daysAgoDate(i);
          const leadsCount = leads.filter((l) => {
            const dt = toDate(l.created_at);
            return dt ? isSameDay(dt, day) : false;
          }).length;
          const callsCount = calls.filter((c) => {
            const dt = toDate(c.created_at);
            return dt ? isSameDay(dt, day) : false;
          }).length;

          dayPoints.push({
            date: day.toISOString(),
            leads: leadsCount,
            calls: callsCount,
          });
        }
        setDailyData(dayPoints);

        const statusMap = {};
        leads.forEach((lead) => {
          const key = lead.status || 'unknown';
          statusMap[key] = (statusMap[key] || 0) + 1;
        });

        setStatusData(
          Object.entries(statusMap)
            .map(([name, val]) => ({ name: name.replace('_', ' '), val }))
            .sort((a, b) => b.val - a.val)
            .slice(0, 6)
        );

        setRecentLeads(
          [...leads]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 6)
        );
      } catch (err) {
        console.error('Failed to fetch dashboard data', err);
        toast.error('Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) return <div className="skeleton" style={{ height: '400px' }} />;

  return (
    <div className="flex-col gap-6">
      {/* ── Stats Overview ──────────────────────────────────── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>
            <Users size={20} />
          </div>
          <div className="stat-label">Total Leads</div>
          <div className="stat-value">{stats?.total_leads || 0}</div>
          <div className={`stat-change ${Number(stats?.leads_delta_pct || 0) >= 0 ? 'up' : 'down'}`}>
            <ArrowUpRight size={14} style={{ marginBottom: '-2px' }} /> {Math.abs(stats?.leads_delta_pct || 0)}% vs prev 7 days
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(6,182,212,0.1)', color: '#06b6d4' }}>
            <Phone size={20} />
          </div>
          <div className="stat-label">Calls Today</div>
          <div className="stat-value">{stats?.total_calls_today || 0}</div>
          <div className={`stat-change ${Number(stats?.calls_delta_pct || 0) >= 0 ? 'up' : 'down'}`}>
            <ArrowUpRight size={14} style={{ marginBottom: '-2px' }} /> {Math.abs(stats?.calls_delta_pct || 0)}% vs prev 7 days
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
            <TrendingUp size={20} />
          </div>
          <div className="stat-label">Conv. Rate</div>
          <div className="stat-value">{stats?.conversion_rate || 0}%</div>
          <div className="stat-change up">
            <ArrowUpRight size={14} style={{ marginBottom: '-2px' }} /> based on converted leads
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(139,92,246,0.1)', color: '#8b5cf6' }}>
            <Clock size={20} />
          </div>
          <div className="stat-label">Avg. Duration</div>
          <div className="stat-value">{stats?.avg_call_duration_seconds || 0}s</div>
          <div className="stat-change up">
            <ArrowUpRight size={14} style={{ marginBottom: '-2px' }} /> from completed call history
          </div>
        </div>
      </div>

      {/* ── Charts ─────────────────────────────────────────── */}
      <div className="charts-grid">
        <div className="chart-card">
          <h3 className="chart-title">Lead & Call Activity</h3>
          <p className="chart-subtitle">Daily performance over the last 14 days</p>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <AreaChart data={dailyData}>
                <defs>
                  <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  stroke="var(--text-muted)" 
                  fontSize={12} 
                  tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                />
                <YAxis stroke="var(--text-muted)" fontSize={12} />
                <Tooltip 
                  contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px' }}
                  itemStyle={{ fontSize: '12px' }}
                />
                <Area type="monotone" dataKey="leads" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorLeads)" />
                <Area type="monotone" dataKey="calls" stroke="#06b6d4" strokeWidth={2} fillOpacity={0} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <h3 className="chart-title">Lead Status Distribution</h3>
          <p className="chart-subtitle">Live counts by current lead stage</p>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={statusData}>
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" stroke="var(--text-primary)" fontSize={12} width={100} />
                <Tooltip 
                   cursor={{fill: 'rgba(255,255,255,0.05)'}}
                   contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px' }}
                />
                <Bar dataKey="val" radius={[0, 4, 4, 0]} barSize={20}>
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Recent Leads ─────────────────────────────────────── */}
      <div className="card">
        <div className="flex justify-between items-center mb-6">
          <h3 className="chart-title">Recent Lead Activity</h3>
          <button className="btn btn-secondary btn-sm">View All</button>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Interest</th>
                <th>Status</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recentLeads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="avatar" style={{ width: 32, height: 32, fontSize: 11 }}>{lead.full_name[0]}</div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{lead.full_name}</div>
                        <div className="text-xs text-muted">{lead.phone || '--'}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className="text-sm">{lead.interest || '--'}</span></td>
                  <td>
                    <span className={`badge badge-${lead.status}`}>
                      <span className="badge-dot" style={{ background: 'currentColor' }} />
                      {lead.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td><span className="text-xs text-muted">{formatRelativeTime(lead.created_at)}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-icon" style={{ color: 'var(--text-muted)' }}>
                      <ArrowUpRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {recentLeads.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    No lead activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="flex justify-between items-center mb-6">
          <h3 className="chart-title">Recent Dispatches</h3>
          <button className="btn btn-secondary btn-sm">View All</button>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th>To</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {recentDispatches.map((notif) => (
                <tr key={notif.id}>
                  <td>
                    <span className="text-xs flex items-center gap-2">
                      {notif.channel === 'email' ? <Mail size={12} /> : <MessageSquare size={12} />}
                      {(notif.channel || 'unknown').toUpperCase()}
                    </span>
                  </td>
                  <td><span className="text-xs">{notif.recipient_phone || notif.recipient_email || '--'}</span></td>
                  <td>
                    <span className={`badge ${notif.status === 'failed' ? 'badge-lost' : 'badge-converted'}`}>
                      {notif.status}
                    </span>
                  </td>
                  <td><span className="text-xs text-muted">{formatRelativeTime(notif.created_at)}</span></td>
                </tr>
              ))}
              {recentDispatches.length === 0 && (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    No recent dispatches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
