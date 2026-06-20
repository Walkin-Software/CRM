import { useState, useEffect, useRef, useCallback } from 'react';
import { Eye, Globe, Compass, Clock, ArrowUpRight, Monitor, Share2, MapPin, Navigation, UserPlus, RefreshCw, Smartphone, Laptop, Shield } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { visitorsAPI } from '../lib/api';

const POLL_INTERVAL = 30_000; // 30 seconds

export default function VisitorIntelligence() {
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedVisitorId, setSelectedVisitorId] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [converting, setConverting] = useState(null);
  const pollRef = useRef(null);

  const selectedVisitor = visitors.find(v => v.id === selectedVisitorId) || visitors[0] || null;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await visitorsAPI.list({ active_only: filterType !== 'all' });
      const items = res.data?.sessions || res.data?.items || [];
      setVisitors(items);
      if (items.length && !selectedVisitorId) setSelectedVisitorId(items[0].id);
    } catch (err) {
      console.error(err);
      if (!silent) toast.error('Failed to load visitor sessions.');
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  // Initial load + polling
  useEffect(() => {
    load();
    pollRef.current = setInterval(() => load(true), POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [load]);

  const handleConvertToLead = async (visitor) => {
    setConverting(visitor.id);
    try {
      await visitorsAPI.convert(visitor.id, {
        name: `Visitor from ${visitor.city || visitor.location || visitor.ip_address}`,
        source: visitor.source,
        interest: visitor.current_page,
      });
      toast.success(`Visitor ${visitor.ip_address} converted to Lead!`);
      load(true);
    } catch {
      toast.error('Failed to convert visitor to lead.');
    } finally {
      setConverting(null);
    }
  };

  // Compute derived stats
  const totalActive = visitors.filter(v => v.is_active).length;
  const avgDuration = visitors.length
    ? Math.round(visitors.reduce((s, v) => s + (v.duration_seconds || 0), 0) / visitors.length)
    : 0;
  const topSource = visitors.length
    ? Object.entries(visitors.reduce((acc, v) => { acc[v.source || 'Direct'] = (acc[v.source || 'Direct'] || 0) + 1; return acc; }, {}))
        .sort((a, b) => b[1] - a[1])[0]?.[0] || '--'
      : '--';
  const uniqueCountries = new Set(visitors.map(v => v.country)).size;

  const filteredVisitors = visitors.filter(v => {
    if (filterType === 'active') return v.is_active;
    if (filterType === 'mobile') return v.device?.toLowerCase().includes('mobile');
    return true;
  });

  const formatDuration = (secs) => {
    if (!secs) return '0m 00s';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  };

  return (
    <div className="flex-col gap-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Visitor Intelligence</h2>
          <p className="page-subtitle">Real-time session logs, demographic IP routing, and user journey profiling.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => load()}>
            <RefreshCw size={14} /> Refresh Stream
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Active Visitors</span>
              <span className="kpi-value">{loading ? '...' : totalActive}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(37,99,235,0.08)', color: '#2563eb' }}>
              <Eye size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: '#16a34a' }}>Live on site now</span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Avg Session Duration</span>
              <span className="kpi-value" style={{ fontSize: 14 }}>{loading ? '...' : formatDuration(avgDuration)}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>
              <Clock size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--text-4)' }}>Across all sessions</span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Top Channel Source</span>
              <span className="kpi-value" style={{ fontSize: 13 }}>{loading ? '...' : topSource}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(16,185,129,0.08)', color: '#10b981' }}>
              <Compass size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--text-4)' }}>Primary acquisition</span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Unique Countries</span>
              <span className="kpi-value">{loading ? '...' : uniqueCountries}</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(249,115,22,0.08)', color: '#f97316' }}>
              <Globe size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--text-4)' }}>From {visitors.length} sessions</span>
        </div>
      </div>

      {/* Main Split Pane */}
      <div className="split-layout-pane">
        {/* Left: Visitor Table */}
        <div className="main-pane-content" style={{ flex: 1.6 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <h3 className="chart-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                Real-Time Session Stream
              </h3>
              <div style={{ display: 'flex', gap: 6 }}>
                {['all', 'active', 'mobile'].map(t => (
                  <button
                    key={t}
                    onClick={() => setFilterType(t)}
                    style={{ padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, border: '1px solid var(--border)', cursor: 'pointer', background: filterType === t ? '#2563eb' : 'white', color: filterType === t ? 'white' : 'var(--text-2)' }}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-4)' }}>Loading visitor sessions...</div>
            ) : filteredVisitors.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>
                No active visitor sessions. Sessions are tracked via the <code>/visitors/track</code> beacon.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th>IP Address</th>
                    <th>Location</th>
                    <th>Source</th>
                    <th>Current Page</th>
                    <th>Time On Site</th>
                    <th>Browser / Device</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVisitors.map(v => (
                    <tr
                      key={v.id}
                      style={{ cursor: 'pointer', background: selectedVisitorId === v.id ? 'rgba(37,99,235,0.04)' : undefined }}
                      onClick={() => setSelectedVisitorId(v.id)}
                    >
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{v.ip_address}</td>
                      <td>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{v.city || '--'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{v.country}</div>
                      </td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: 'rgba(37,99,235,0.08)', color: '#2563eb' }}>
                          {v.source || 'Direct'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: '#7c3aed', fontWeight: 500 }}>{v.current_page || '/'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-4)' }}>{formatDuration(v.duration_seconds)}</td>
                      <td>
                        <div style={{ fontSize: 12 }}>{v.browser}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{v.device}</div>
                      </td>
                      <td>
                        {!v.converted_lead_id ? (
                          <button
                            className="btn btn-primary btn-sm"
                            style={{ fontSize: 11 }}
                            disabled={converting === v.id}
                            onClick={e => { e.stopPropagation(); handleConvertToLead(v); }}
                          >
                            <UserPlus size={11} /> {converting === v.id ? '...' : 'Lead'}
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>Converted</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: Detail Panel */}
        <div className="details-pane-container" style={{ width: 360 }}>
          {selectedVisitor ? (
            <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Live badge */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Session Detail</h4>
                {selectedVisitor.is_active && (
                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>â— Live</span>
                )}
              </div>

              {/* IP + Location */}
              <div style={{ background: 'var(--bg-2)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{selectedVisitor.ip_address}</div>
                <div style={{ fontSize: 12, color: 'var(--text-4)' }}><MapPin size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />{selectedVisitor.location || [selectedVisitor.city, selectedVisitor.country].filter(Boolean).join(', ') || 'Unknown'}</div>
                {selectedVisitor.isp && <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{selectedVisitor.isp}</div>}
                {selectedVisitor.coordinates && <div style={{ fontSize: 11, color: 'var(--text-4)' }}><Navigation size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />{selectedVisitor.coordinates}</div>}
              </div>

              {/* Session info */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                {[
                  ['Source', selectedVisitor.source || 'Direct'],
                  ['Current Page', selectedVisitor.current_page || '/'],
                  ['Duration', formatDuration(selectedVisitor.duration_seconds)],
                  ['Browser', selectedVisitor.browser],
                  ['Device', selectedVisitor.device],
                  ['OS', selectedVisitor.os],
                  ['Screen', selectedVisitor.screen],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-4)', fontWeight: 500 }}>{label}</span>
                    <span style={{ fontWeight: 600 }}>{value || '--'}</span>
                  </div>
                ))}
              </div>

              {/* Journey */}
              {selectedVisitor.journey?.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Page Journey</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(Array.isArray(selectedVisitor.journey) ? selectedVisitor.journey : []).map((step, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-4)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: i === selectedVisitor.journey.length - 1 ? '#10b981' : '#cbd5e1', flexShrink: 0 }} />
                        <span style={{ fontWeight: 500, color: 'var(--text-2)' }}>{step.page || step}</span>
                        {step.time && <span style={{ marginLeft: 'auto' }}>{step.time}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Convert action */}
              {!selectedVisitor.converted_lead_id && (
                <button
                  className="btn btn-primary"
                  disabled={converting === selectedVisitor.id}
                  onClick={() => handleConvertToLead(selectedVisitor)}
                >
                  <UserPlus size={13} /> {converting === selectedVisitor.id ? 'Converting...' : 'Convert to Lead'}
                </button>
              )}
              {selectedVisitor.converted_lead_id && (
                <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 600, textAlign: 'center' }}>Converted to Lead</div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-4)', fontSize: 13 }}>
              Select a visitor to view session details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

