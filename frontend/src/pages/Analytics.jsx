import { useEffect, useState } from 'react';
import { 
  BarChart as BarChartIcon, TrendingUp, Users, 
  Phone, Target, Zap, ChevronDown 
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  LineChart, Line
} from 'recharts';
import { analyticsAPI } from '../lib/api';

const COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];

export default function Analytics() {
  const [overview, setOverview] = useState(null);
  const [funnel, setFunnel] = useState([]);
  const [loading, setLoading] = useState(true);

  const sourceData = overview?.top_lead_sources || [];
  const hasFunnel = funnel.length > 0;
  const hasSourceData = sourceData.length > 0;
  const funnelMax = hasFunnel ? Math.max(...funnel.map((f) => Number(f.count || 0)), 0) : 10;
  const funnelData = hasFunnel ? funnel : [{ stage: 'No data', count: 0, percentage: 0 }];
  const sourceFallbackData = [
    { name: 'A', value: 0 },
    { name: 'B', value: 0 },
    { name: 'C', value: 0 },
    { name: 'D', value: 0 },
  ];

  useEffect(() => {
    async function fetchData() {
      try {
        const [overRes, funnelRes] = await Promise.all([
          analyticsAPI.overview(),
          analyticsAPI.funnel()
        ]);
        setOverview(overRes.data);
        setFunnel(funnelRes.data.funnel);
      } catch (err) {
        console.error('Failed to fetch analytics', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) return <div className="skeleton" style={{ height: '600px' }} />;

  return (
    <div className="flex-col gap-6">
      <div className="page-header">
        <div>
          <h2 className="page-title">Analytics & Insights</h2>
          <p className="page-subtitle">Detailed performance metrics and conversion tracking</p>
        </div>
        <div className="flex gap-3">
          <button className="btn btn-secondary">
            Last 30 Days <ChevronDown size={16} />
          </button>
        </div>
      </div>

      {/* ── Conversion Funnel ──────────────────────────────── */}
      <div className="card">
        <h3 className="chart-title mb-6">Conversion Funnel</h3>
        <div className="flex gap-8 items-center" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '300px', height: '300px' }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={funnelData}>
                <XAxis type="number" stroke="var(--text-muted)" fontSize={11} domain={[0, Math.max(funnelMax, 10)]} />
                <YAxis dataKey="stage" type="category" stroke="var(--text-primary)" fontSize={12} width={120} />
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <Tooltip 
                   cursor={{fill: 'rgba(255,255,255,0.05)'}}
                   contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px' }}
                />
                <Bar dataKey="count" fill="var(--brand-primary)" radius={[0, 4, 4, 0]} barSize={32}>
                  {funnelData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fillOpacity={1 - index * 0.15} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {!hasFunnel && <div className="chart-empty-overlay">No funnel data available</div>}
          </div>
          <div className="flex-col gap-4" style={{ flex: 1, minWidth: '250px' }}>
            {(hasFunnel ? funnel : [{ stage: 'No data', count: 0, percentage: 0 }]).map((item, i) => (
              <div key={i} className="flex justify-between items-center p-3 rounded" style={{ background: 'var(--bg-elevated)' }}>
                <div className="flex items-center gap-3">
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length] }} />
                  <span className="text-sm font-medium">{item.stage}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-bold">{item.count}</span>
                  <span className="text-xs text-muted" style={{ width: '40px', textAlign: 'right' }}>{item.percentage}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="charts-grid">
        {/* ── Lead Sources ────────────────────────────────── */}
        <div className="chart-card">
          <h3 className="chart-title">Lead Sources</h3>
          <p className="chart-subtitle">Distribution by acquisition channel</p>
          <div style={{ width: '100%', height: 250 }}>
            {hasSourceData ? (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={sourceData}
                    cx="50%" cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="count"
                    nameKey="source"
                  >
                    {sourceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                <ResponsiveContainer>
                  <LineChart data={sourceFallbackData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                    <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={10} />
                    <YAxis stroke="var(--text-muted)" fontSize={10} domain={[0, 10]} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="chart-empty-overlay">No lead source data available</div>
              </div>
            )}
          </div>
          <div className="flex justify-center gap-4 flex-wrap mt-4">
            {(hasSourceData ? sourceData : [{ source: 'No data', count: 0 }]).map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length] }} />
                <span className="text-xs text-muted">{item.source.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Revenue / Value ─────────────────────────────── */}
        <div className="chart-card">
          <h3 className="chart-title">Revenue Growth</h3>
          <p className="chart-subtitle">Monthly projected vs actual revenue</p>
          <div style={{ width: '100%', height: 250 }}>
            <ResponsiveContainer>
              <LineChart data={[
                { name: 'Week 1', rev: 120000 },
                { name: 'Week 2', rev: 180000 },
                { name: 'Week 3', rev: 150000 },
                { name: 'Week 4', rev: 240000 },
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={10} />
                <YAxis stroke="var(--text-muted)" fontSize={10} />
                <Tooltip 
                  contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px' }}
                />
                <Line type="monotone" dataKey="rev" stroke="var(--brand-success)" strokeWidth={3} dot={{ r: 4, fill: 'var(--brand-success)' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="stat-change up mt-4" style={{ textAlign: 'center', fontSize: '14px' }}>
            <Zap size={16} /> Projected: ₹8,40,000 next month
          </div>
        </div>
      </div>
    </div>
  );
}
