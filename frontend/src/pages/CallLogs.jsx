import { useEffect, useState, useRef, useCallback } from 'react';
import { 
  PhoneIncoming, PhoneOutgoing, Clock, Play, Pause, Download, Search, Filter, 
  ChevronLeft, ChevronRight, Eye, Phone, MessageSquare, Send,
  Sparkles, ChevronDown, CheckCircle, Calendar, Plus
} from 'lucide-react';
import { callsAPI } from '../lib/api';
import { toast } from 'react-hot-toast';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

function formatDuration(seconds) {
  const s = Math.max(0, seconds || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${String(r).padStart(2, '0')}s`;
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function getCallStatusUI(status) {
  const key = (status || '').toLowerCase();
  if (key === 'answered' || key === 'completed') {
    return { label: 'Answered', badge: 'badge-converted', color: '#16a34a' };
  }
  if (key === 'hangup') {
    return { label: 'Hangup', badge: 'badge-qualified', color: '#7c3aed' };
  }
  if (key === 'no_response' || key === 'no_answer' || key === 'busy' || key === 'failed') {
    return { label: 'Missed', badge: 'badge-lost', color: '#ef4444' };
  }
  return { label: status?.replace('_', ' '), badge: 'badge-contacted', color: '#2563eb' };
}

// Sparkline helper
function Sparkline({ color, data }) {
  const chartData = (data || [30, 40, 35, 50, 45, 60, 55]).map((val, index) => ({ id: index, val }));
  const gradId = `callSparkGrad-${color.replace('#', '')}`;
  return (
    <div className="kpi-sparkline" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 30, width: '100%', pointerEvents: 'none' }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.15} />
              <stop offset="100%" stopColor={color} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="val" stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function CallLogs() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterType, setFilterType] = useState('All');

  const [selectedCall, setSelectedCall] = useState(null);
  const [detailsTab, setDetailsTab] = useState('Summary');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrent, setAudioCurrent] = useState(0);

  const [transcriptData, setTranscriptData] = useState(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [recordingSrc, setRecordingSrc] = useState(null);
  const [recordingLoading, setRecordingLoading] = useState(false);
  const [recordingError, setRecordingError] = useState(null);

  const audioRef = useRef(null);

  useEffect(() => {
    async function fetchCalls() {
      setLoading(true);
      try {
        const res = await callsAPI.list({ page, page_size: 10 });
        const items = res.data.items || [];
        setCalls(items);
        setTotal(res.data.total || 0);
        setSelectedCall(items[0] || null);
      } catch (err) {
        setCalls([]);
        setTotal(0);
        setSelectedCall(null);
        toast.error(err.response?.data?.detail || 'Failed to load call logs');
      } finally {
        setLoading(false);
      }
    }
    fetchCalls();
  }, [page]);

  const activeDetailCall = selectedCall;

  const loadTranscript = useCallback(async (callId) => {
    if (!callId) return;
    setTranscriptLoading(true);
    setTranscriptData(null);
    try {
      const res = await callsAPI.transcript(callId);
      setTranscriptData(res.data);
    } catch (err) {
      if (err.response?.status !== 404) {
        const detail = err.response?.data?.detail;
        if (detail && !String(detail).includes('Transcript generation failed')) {
          toast.error(typeof detail === 'string' ? detail : 'Failed to load transcript');
        }
      }
    } finally {
      setTranscriptLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeDetailCall?.id) {
      setTranscriptData(null);
      return;
    }
    loadTranscript(activeDetailCall.id);
  }, [activeDetailCall?.id, loadTranscript]);

  useEffect(() => {
    if (!activeDetailCall?.id) {
      setRecordingSrc(null);
      setRecordingError(null);
      return;
    }

    let cancelled = false;
    let objectUrl = null;

    async function loadRecording() {
      setRecordingLoading(true);
      setRecordingError(null);
      setRecordingSrc(null);
      setIsPlaying(false);
      setPlayProgress(0);
      setAudioCurrent(0);
      setAudioDuration(activeDetailCall.duration_seconds || 0);

      try {
        const res = await callsAPI.recording(activeDetailCall.id);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setRecordingSrc(objectUrl);
      } catch (err) {
        if (cancelled) return;
        const detail = err.response?.data?.detail;
        setRecordingError(
          err.response?.status === 404
            ? 'No recording available for this call yet.'
            : (typeof detail === 'string' ? detail : 'Failed to load recording')
        );
      } finally {
        if (!cancelled) setRecordingLoading(false);
      }
    }

    loadRecording();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeDetailCall?.id, activeDetailCall?.duration_seconds]);

  const handleAudioTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    setAudioCurrent(audio.currentTime);
    setAudioDuration(audio.duration);
    setPlayProgress((audio.currentTime / audio.duration) * 100);
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio || !recordingSrc) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => toast.error('Could not play recording'));
    }
  };

  const handleSeek = (e) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    setPlayProgress(ratio * 100);
    setAudioCurrent(audio.currentTime);
  };

  const handleDownloadRecording = async () => {
    if (!activeDetailCall?.id) return;
    try {
      const res = await callsAPI.download(activeDetailCall.id);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `call-${activeDetailCall.id}.mp3`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Recording download failed');
    }
  };

  const answeredCount = calls.filter((c) => ['answered', 'completed'].includes(c.status?.toLowerCase())).length;
  const missedCount = calls.filter((c) => ['no_response', 'no_answer', 'busy', 'failed'].includes(c.status?.toLowerCase())).length;
  const inboundCount = calls.filter((c) => c.direction === 'inbound').length;
  const outboundCount = calls.filter((c) => c.direction === 'outbound').length;
  const avgDuration = calls.length
    ? Math.round(calls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / calls.length)
    : 0;
  const connectionRate = calls.length ? ((answeredCount / calls.length) * 100).toFixed(1) : '0.0';

  const kpis = [
    { label: 'Total Calls', value: total.toLocaleString(), color: '#2563eb', bg: 'rgba(37,99,235,0.08)', sparkData: [30, 45, 35, 60, 40, 75, total || 0] },
    { label: 'Answered Calls', value: answeredCount.toLocaleString(), color: '#10b981', bg: 'rgba(16,185,129,0.08)', sparkData: [50, 40, 65, 55, 80, 70, answeredCount] },
    { label: 'Missed Calls', value: missedCount.toLocaleString(), color: '#ef4444', bg: 'rgba(239,68,68,0.08)', sparkData: [40, 30, 35, 28, 45, 32, missedCount] },
    { label: 'Avg. Call Duration', value: formatDuration(avgDuration), color: '#7c3aed', bg: 'rgba(124,58,237,0.08)', sparkData: [20, 30, 25, 45, 35, 50, avgDuration] },
    { label: 'On This Page', value: calls.length.toLocaleString(), color: '#f97316', bg: 'rgba(249,115,22,0.08)', sparkData: [15, 20, 18, 28, 24, 32, calls.length] },
    { label: 'Connection Rate', value: `${connectionRate}%`, color: '#06b6d4', bg: 'rgba(6,182,212,0.08)', sparkData: [45, 55, 48, 65, 58, 72, Number(connectionRate)] },
  ];

  const filteredCalls = calls.filter((call) => {
    if (filterType === 'Inbound') return call.direction === 'inbound';
    if (filterType === 'Outbound') return call.direction === 'outbound';
    if (filterType === 'Missed') return ['no_response', 'no_answer', 'busy', 'failed'].includes(call.status?.toLowerCase());
    return true;
  });

  const contactLabel = (call) => call.direction === 'inbound' ? call.from_number : call.to_number;
  const contactInitials = (call) => {
    const num = contactLabel(call) || '';
    return num.slice(-2) || '??';
  };

  return (
    <div className="flex-col gap-6">
      {/* ── Page Header ── */}
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div>
          <h2 className="page-title" style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-1)' }}>Call Logs</h2>
          <p className="page-subtitle" style={{ fontSize: '12px', color: 'var(--text-3)' }}>Track, analyze and manage all your call interactions.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" style={{ display: 'flex', gap: 6, fontSize: '11.5px', fontWeight: 600 }}>
            <Calendar size={13} style={{ color: 'var(--text-4)' }} />
            May 15, 2024 - May 21, 2024
            <ChevronDown size={12} />
          </button>
          <button className="btn btn-secondary btn-sm" style={{ display: 'flex', gap: 4, fontWeight: 600 }}>
            <Filter size={13} /> Filter
          </button>
          <button className="btn btn-secondary btn-sm" style={{ display: 'flex', gap: 4, fontWeight: 600 }}>
            <Download size={13} /> Export
          </button>
          <button className="btn btn-primary btn-sm" style={{ display: 'flex', gap: 4, fontWeight: 600, background: '#2563eb', border: 'none', color: 'white' }}>
            <Phone size={13} /> Phone Settings
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
                <Phone size={15} />
              </div>
            </div>
            <div className="kpi-content">
              <span className="kpi-value">{k.value}</span>
              <span className="kpi-trend" style={{ color: 'var(--success)' }}>
                ↑ 18.6% <span style={{ color: 'var(--text-4)', fontWeight: 500 }}>vs last 7d</span>
              </span>
            </div>
            <Sparkline color={k.color} data={k.sparkData} />
          </div>
        ))}
      </div>

      {/* ── Row 2: Split 3-Pane Layout ── */}
      <div className="split-layout-pane">
        {/* Main Content Pane */}
        <div className="main-pane-content">
          <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              {/* Custom call type tabs */}
              <div className="activities-tabs" style={{ margin: 0, padding: 0, border: 'none' }}>
                {[
                  { id: 'All', label: 'All Calls', count: total },
                  { id: 'Inbound', label: 'Inbound', count: inboundCount },
                  { id: 'Outbound', label: 'Outbound', count: outboundCount },
                  { id: 'Missed', label: 'Missed', count: missedCount }
                ].map((tab) => (
                  <button 
                    key={tab.id} 
                    className={`activity-tab ${filterType === tab.id ? 'active' : ''}`}
                    onClick={() => setFilterType(tab.id)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    {tab.label}
                    <span style={{ fontSize: '9px', opacity: 0.7 }}>({tab.count})</span>
                  </button>
                ))}
              </div>

              {/* Quick Filters */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="search-container" style={{ width: 160 }}>
                  <Search className="input-icon" size={13} style={{ left: 8 }} />
                  <input
                    type="text"
                    placeholder="Search calls..."
                    className="input"
                    style={{ paddingLeft: '26px', fontSize: '11.5px', padding: '4px 8px 4px 26px', borderRadius: '4px' }}
                  />
                </div>
                <button className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Columns <ChevronDown size={11} />
                </button>
              </div>
            </div>

            {/* Table layout */}
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ padding: '10px 14px' }}>Call Info</th>
                    <th style={{ padding: '10px 14px' }}>Contact</th>
                    <th style={{ padding: '10px 14px' }}>Type</th>
                    <th style={{ padding: '10px 14px' }}>Status</th>
                    <th style={{ padding: '10px 14px' }}>Duration</th>
                    <th style={{ padding: '10px 14px' }}>Team Member</th>
                    <th style={{ padding: '10px 14px' }}>Date & Time</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array(4).fill(0).map((_, i) => (
                      <tr key={i}><td colSpan="8"><div className="skeleton" style={{ height: '32px' }} /></td></tr>
                    ))
                  ) : filteredCalls.length === 0 ? (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', padding: '36px', color: 'var(--text-4)' }}>No calls logged under this category.</td>
                    </tr>
                  ) : (
                    filteredCalls.map((call) => {
                      const isActive = activeDetailCall?.id === call.id;
                      const statusUI = getCallStatusUI(call.status);
                      const isCallInbound = call.direction === 'inbound';
                      
                      return (
                        <tr 
                          key={call.id} 
                          style={{ cursor: 'pointer', background: isActive ? 'rgba(37,99,235,0.03)' : 'none' }}
                          onClick={() => setSelectedCall(call)}
                        >
                          <td>
                            <div>
                              <div style={{ fontWeight: 700, color: 'var(--text-1)' }}>{isCallInbound ? call.from_number : call.to_number}</div>
                              <div style={{ fontSize: '10px', color: 'var(--text-4)' }}>Bengaluru, India</div>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div className="avatar" style={{ width: 22, height: 22, fontSize: 9, background: 'var(--primary)' }}>
                                {contactInitials(call)}
                              </div>
                              <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>{contactLabel(call)}</span>
                            </div>
                          </td>
                          <td>
                            {isCallInbound ? (
                              <span className="badge badge-inbound" style={{ padding: '1px 5px' }}>
                                <PhoneIncoming size={10} style={{ marginRight: 2 }} /> Inbound
                              </span>
                            ) : (
                              <span className="badge badge-outbound" style={{ padding: '1px 5px' }}>
                                <PhoneOutgoing size={10} style={{ marginRight: 2 }} /> Outbound
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${statusUI.badge}`} style={{ padding: '2px 6px' }}>
                              {statusUI.label}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Clock size={12} style={{ color: 'var(--text-4)' }} />
                              {formatDuration(call.duration_seconds)}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=100&q=80" alt="Agent" style={{ width: 18, height: 18, borderRadius: '50%' }} />
                              <span style={{ fontSize: '10.5px' }}>Priya Mehta</span>
                            </div>
                          </td>
                          <td style={{ color: 'var(--text-4)' }}>
                            {new Date(call.created_at || Date.now()).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} • {new Date(call.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'inline-flex', gap: 4 }}>
                              <button
                                className="btn-icon"
                                style={{ padding: 4 }}
                                title="Play recording"
                                onClick={() => { setSelectedCall(call); setDetailsTab('Recording'); }}
                              >
                                <Play size={11} style={{ color: 'var(--primary)' }} />
                              </button>
                              <button
                                className="btn-icon"
                                style={{ padding: 4 }}
                                title="View transcript"
                                onClick={() => { setSelectedCall(call); setDetailsTab('Summary'); }}
                              >
                                <Eye size={11} style={{ color: 'var(--text-3)' }} />
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
                Page {page} of {Math.ceil(total / 10) || 1}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" style={{ padding: 4 }} disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft size={13} />
                </button>
                <button className="btn btn-secondary btn-sm" style={{ padding: 4 }} disabled={page >= Math.ceil(total / 10)} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Details Panel: Call Details */}
        <div className="details-pane-container">
          {activeDetailCall ? (
            <>
              {/* Header profile info */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="avatar" style={{ width: 34, height: 34, fontSize: 13, background: 'var(--primary)' }}>
                    {contactInitials(activeDetailCall)}
                  </div>
                  <div>
                    <h3 style={{ margin: 0 }}>{contactLabel(activeDetailCall)}</h3>
                    <div style={{ fontSize: '10px', color: 'var(--text-4)' }}>
                      {activeDetailCall.direction === 'inbound' ? 'Inbound caller' : 'Outbound contact'}
                    </div>
                  </div>
                </div>

                <span className={`badge ${getCallStatusUI(activeDetailCall.status).badge}`} style={{ padding: '2px 6px' }}>
                  {getCallStatusUI(activeDetailCall.status).label}
                </span>
              </div>

              {/* Call Details Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: '#f8fafc', padding: 8, borderRadius: 8, fontSize: '11px' }}>
                <div>
                  <span style={{ color: 'var(--text-4)', display: 'block' }}>Call Type</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-2)', textTransform: 'capitalize' }}>{activeDetailCall.direction}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-4)', display: 'block' }}>Duration</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-2)' }}>{formatDuration(activeDetailCall.duration_seconds)}</span>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <span style={{ color: 'var(--text-4)', display: 'block' }}>Date & Time</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-2)' }}>{new Date(activeDetailCall.created_at || Date.now()).toLocaleString()}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, margin: '4px 0' }}>
                <button className="btn btn-secondary" style={{ padding: '6px 0', flexDirection: 'column', height: 'auto', gap: 4 }} onClick={() => toast.success('Calling customer...')}>
                  <Phone size={13} style={{ color: '#16a34a' }} />
                  <span style={{ fontSize: '9.5px', fontWeight: 600 }}>Call</span>
                </button>
                <button className="btn btn-secondary" style={{ padding: '6px 0', flexDirection: 'column', height: 'auto', gap: 4 }} onClick={() => toast.success('Opening WhatsApp...')}>
                  <Send size={13} style={{ color: '#25D366' }} />
                  <span style={{ fontSize: '9.5px', fontWeight: 600 }}>WhatsApp</span>
                </button>
                <button className="btn btn-secondary" style={{ padding: '6px 0', flexDirection: 'column', height: 'auto', gap: 4 }} onClick={() => toast.success('Note logging initialized!')}>
                  <MessageSquare size={13} style={{ color: 'var(--primary)' }} />
                  <span style={{ fontSize: '9.5px', fontWeight: 600 }}>Note</span>
                </button>
                <button className="btn btn-secondary" style={{ padding: '6px 0', flexDirection: 'column', height: 'auto', gap: 4 }} onClick={() => toast.success('Support Ticket created!')}>
                  <Plus size={13} style={{ color: '#f97316' }} />
                  <span style={{ fontSize: '9.5px', fontWeight: 600 }}>Ticket</span>
                </button>
              </div>

              {/* Panel Tabs */}
              <div className="details-pane-tabs">
                {['Summary', 'Notes', 'Activities', 'Recording'].map((t) => (
                  <button 
                    key={t} 
                    className={`details-pane-tab ${detailsTab === t ? 'active' : ''}`}
                    onClick={() => setDetailsTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Dynamic details content */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, fontSize: '11.5px' }}>
                {detailsTab === 'Summary' && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-1)' }}>Call Summary</span>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '2px 6px', fontSize: '9.5px', display: 'flex', alignItems: 'center', gap: 2 }}
                        onClick={() => loadTranscript(activeDetailCall.id)}
                      >
                        <Sparkles size={10} /> Refresh
                      </button>
                    </div>
                    {transcriptLoading ? (
                      <div className="skeleton" style={{ height: 60 }} />
                    ) : transcriptData?.summary ? (
                      <p style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.45 }}>{transcriptData.summary}</p>
                    ) : transcriptData?.transcript ? (
                      <p style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                        {transcriptData.transcript}
                      </p>
                    ) : (
                      <p style={{ margin: 0, color: 'var(--text-4)' }}>
                        No transcript yet. Recordings are transcribed after the call ends.
                      </p>
                    )}

                    {transcriptData?.qa?.length > 0 && (
                      <>
                        <span style={{ fontWeight: 700, color: 'var(--text-1)', marginTop: 4, display: 'block' }}>Q&amp;A</span>
                        <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--text-3)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {transcriptData.qa.map((item, idx) => (
                            <li key={idx}>
                              {item.question && <div><strong>Q:</strong> {item.question}</div>}
                              <div><strong>A:</strong> {item.answer}</div>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}

                {detailsTab === 'Notes' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ border: '1px solid var(--border)', padding: 8, borderRadius: 6, background: '#f8fafc' }}>
                      <div style={{ fontWeight: 700 }}>Priya Mehta:</div>
                      <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '11px', marginTop: 2 }}>Customer wants pricing structure matching Twilio API consumption.</p>
                    </div>
                  </div>
                )}

                {detailsTab === 'Activities' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-4)', textTransform: 'capitalize' }}>{activeDetailCall.direction} call</span>
                      <span style={{ fontWeight: 600 }}>{new Date(activeDetailCall.created_at).toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-4)' }}>Status</span>
                      <span style={{ fontWeight: 600 }}>{getCallStatusUI(activeDetailCall.status).label}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-4)' }}>Handled by</span>
                      <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{activeDetailCall.handled_by || 'ai'}</span>
                    </div>
                  </div>
                )}

                {detailsTab === 'Recording' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700 }}>Call Recording</span>
                      {recordingSrc && (
                        <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', display: 'flex', gap: 4 }} onClick={handleDownloadRecording}>
                          <Download size={11} /> Download
                        </button>
                      )}
                    </div>

                    {recordingLoading ? (
                      <div className="skeleton" style={{ height: 48 }} />
                    ) : recordingError ? (
                      <p style={{ margin: 0, color: 'var(--text-4)', fontSize: '11.5px' }}>{recordingError}</p>
                    ) : (
                      <div className="call-recording-player">
                        {recordingSrc && (
                          <audio
                            ref={audioRef}
                            src={recordingSrc}
                            onTimeUpdate={handleAudioTimeUpdate}
                            onLoadedMetadata={handleAudioTimeUpdate}
                            onEnded={() => setIsPlaying(false)}
                          />
                        )}
                        <div className="call-recording-controls">
                          <button
                            type="button"
                            className={`call-recording-play-btn${isPlaying ? ' is-playing' : ''}`}
                            onClick={togglePlayback}
                            disabled={!recordingSrc}
                            aria-label={isPlaying ? 'Pause recording' : 'Play recording'}
                          >
                            {isPlaying ? <Pause size={16} strokeWidth={2.5} /> : <Play size={16} strokeWidth={2.5} className="play-icon" />}
                          </button>
                          <div className="call-recording-timeline">
                            <div
                              className={`call-recording-track${recordingSrc ? '' : ' is-disabled'}`}
                              onClick={handleSeek}
                            >
                              <div className="call-recording-fill" style={{ width: `${playProgress}%` }} />
                              <span className="call-recording-thumb" style={{ left: `${playProgress}%` }} />
                            </div>
                            <div className="call-recording-times">
                              <span>{formatClock(audioCurrent)}</span>
                              <span>{formatClock(audioDuration || activeDetailCall.duration_seconds)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {transcriptData?.transcript && (
                      <>
                        <span style={{ fontWeight: 700, marginTop: 4 }}>Transcript</span>
                        <p style={{ margin: 0, color: 'var(--text-3)', lineHeight: 1.45, whiteSpace: 'pre-wrap', fontSize: '11px' }}>
                          {transcriptData.transcript}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Next Best Action Footer */}
              {transcriptData?.summary && (
                <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div style={{ background: '#f0fdf4', border: '1px solid rgba(22, 163, 74, 0.2)', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <CheckCircle size={14} style={{ color: '#16a34a', flexShrink: 0, marginTop: 1 }} />
                      <div style={{ fontSize: '11px', lineHeight: 1.4, color: '#166534' }}>
                        <strong>Summary:</strong> {transcriptData.summary}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-4)' }}>Select a call to examine records.</div>
          )}
        </div>
      </div>
    </div>
  );
}
