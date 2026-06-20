import { useEffect, useMemo, useState } from 'react';
import { Target, Users, Phone, Zap, RefreshCw, PieChart as PieIcon, TrendingUp } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  AreaChart, Area
} from 'recharts';
import { analyticsAPI } from '../lib/api';
import { toast } from 'react-hot-toast';

const COLORS = ['#2563eb', '#7c3aed', '#0d9488', '#16a34a', '#f59e0b', '#dc2626'];

function parsePercent(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value.replace('%', '')) || 0;
  return 0;
}

export default function Analytics() {
  const [overview, setOverview] = useState(null);
  const [funnel, setFunnel] = useState([]);
  const [daily, setDaily] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const [overRes, funnelRes, dailyRes] = await Promise.all([
        analyticsAPI.overview(),
        analyticsAPI.funnel(),
        analyticsAPI.daily({ days: 30 }),
      ]);

      setOverview(overRes.data || {});
      setFunnel(funnelRes.data?.funnel || []);
      setDaily(dailyRes.data?.items || []);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load analytics.');
      setOverview({});
      setFunnel([]);
      setDaily([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, []);

  const sourceData = overview?.top_lead_sources || [];
  const hourlyCallData = overview?.hourly_calls || [];

  const revenueTrend = useMemo(() => {
    let running = 0;
    return (daily || []).map((d) => {
      const estimated = (d.leads || 0) * 1200 + (d.calls || 0) * 150;
      running += estimated;
      return {
        label: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        estimated,
        cumulative: running,
      };
    });
  }, [daily]);

  const conversionRate = overview?.conversion_rate || '0%';
  const connectionRate = overview?.connection_rate || '0%';

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="skeleton" style={{ height: '48px' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          <div className="skeleton" style={{ height: '116px' }} />
          <div className="skeleton" style={{ height: '116px' }} />
          <div className="skeleton" style={{ height: '116px' }} />
          <div className="skeleton" style={{ height: '116px' }} />
        </div>
        <div className="skeleton" style={{ height: '360px' }} />
      </div>
    );
  }

  return (
    <div className="flex-col gap-6">
      <div className="page-header">
        <div>
          <h2 className="page-title">Analytics & Insights</h2>
          <p className="page-subtitle">Business performance metrics, conversion funnels, and call diagnostics.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={loadAnalytics}>
            <RefreshCw size={14} /> Refresh Analytics
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Total Projected Revenue</span>
              <span className="kpi-value" style={{ fontSize: 14 }}>{overview?.total_revenue || 'INR 0'}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(22,163,74,0.08)', color: '#16a34a' }}>
              <Zap size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: '#16a34a' }}>Live revenue snapshot</span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Leads Conversion Rate</span>
              <span className="kpi-value" style={{ fontSize: 14 }}>{conversionRate}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>
              <Target size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--text-4)' }}>From all leads</span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Voice Interactions Count</span>
              <span className="kpi-value" style={{ fontSize: 14 }}>{overview?.total_calls ?? 0}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(37,99,235,0.08)', color: '#2563eb' }}>
              <Phone size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--text-4)' }}>Last 30 days</span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Connection Success Rate</span>
              <span className="kpi-value" style={{ fontSize: 14 }}>{connectionRate}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(249,115,22,0.08)', color: '#f97316' }}>
              <Users size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: parsePercent(connectionRate) >= 70 ? '#16a34a' : '#f97316' }}>Answered vs total calls</span>
        </div>
      </div>

      <div className="card">
        <h3 className="chart-title" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Target size={15} style={{ color: '#7c3aed' }} /> Lead Acquisition Conversion Funnel
        </h3>
        <p className="chart-subtitle">Prospect movement across pipeline stages</p>
        <div style={{ width: '100%', height: 280, marginTop: 10 }}>
          <ResponsiveContainer>
            <BarChart data={funnel} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="stage" width={120} />
              <Tooltip />
              <Bar dataKey="count" fill="#7c3aed" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }} className="kpi-row-grid">
        <div className="card">
          <h3 className="chart-title" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Phone size={15} style={{ color: '#2563eb' }} /> Call Frequency by Hour
          </h3>
          <p className="chart-subtitle">Hourly distribution of inbound and outbound calls</p>
          <div style={{ width: '100%', height: 240, marginTop: 10 }}>
            <ResponsiveContainer>
              <BarChart data={hourlyCallData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h3 className="chart-title" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <PieIcon size={15} style={{ color: '#0d9488' }} /> Lead Acquisition Channels
          </h3>
          <p className="chart-subtitle">Distribution by lead generation source</p>
          <div style={{ width: '100%', height: 240, marginTop: 10 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={sourceData} dataKey="count" nameKey="source" innerRadius={55} outerRadius={80} paddingAngle={2}>
                  {sourceData.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="chart-title" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <TrendingUp size={15} style={{ color: '#16a34a' }} /> Monthly Projected Revenue Growth
        </h3>
        <p className="chart-subtitle">Estimated value from daily lead and call activity</p>
        <div style={{ width: '100%', height: 240, marginTop: 10 }}>
          <ResponsiveContainer>
            <AreaChart data={revenueTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="cumulative" stroke="#16a34a" fill="rgba(22,163,74,0.12)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
