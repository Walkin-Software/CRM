import { useEffect, useState } from 'react';
import { 
  PhoneIncoming, PhoneOutgoing, Clock, 
  Play, Download, Search, Filter, 
  ChevronLeft, ChevronRight, BarChart, Eye 
} from 'lucide-react';
import { callsAPI } from '../lib/api';
import { toast } from 'react-hot-toast';

function getCallStatusUI(status) {
  const key = (status || '').toLowerCase();
  if (key === 'answered' || key === 'completed') {
    return { label: 'Answered', badge: 'badge-converted' };
  }
  if (key === 'hangup') {
    return { label: 'Hangup', badge: 'badge-qualified' };
  }
  if (key === 'no_response' || key === 'no_answer' || key === 'busy' || key === 'failed') {
    return { label: 'No Response', badge: 'badge-lost' };
  }
  if (key === 'in_progress') {
    return { label: 'In Progress', badge: 'badge-contacted' };
  }
  if (key === 'ringing') {
    return { label: 'Ringing', badge: 'badge-demo' };
  }
  return { label: (status || 'initiated').replace('_', ' '), badge: 'badge-contacted' };
}

function canUseCallMedia(call) {
  const status = (call?.status || '').toLowerCase();
  return status === 'answered' || status === 'completed';
}

export default function CallLogs() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerUrl, setPlayerUrl] = useState('');
  const [playerTitle, setPlayerTitle] = useState('');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptData, setTranscriptData] = useState(null);

  useEffect(() => {
    async function fetchCalls() {
      setLoading(true);
      try {
        const res = await callsAPI.list({ page, page_size: 10 });
        setCalls(res.data.items || []);
        setTotal(res.data.total || 0);
      } catch (err) {
        setCalls([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    }
    fetchCalls();
  }, [page]);

  const totalDurationSeconds = calls.reduce((acc, call) => acc + (call.duration_seconds || 0), 0);
  const totalDurationHours = (totalDurationSeconds / 3600).toFixed(1);

  const handlePlay = async (call) => {
    if (!canUseCallMedia(call)) {
      toast.error('Recording is available only for answered calls');
      return;
    }
    try {
      const res = await callsAPI.recording(call.id);
      const url = URL.createObjectURL(res.data);
      if (playerUrl) URL.revokeObjectURL(playerUrl);
      setPlayerUrl(url);
      setPlayerTitle(`${call.direction} call • ${new Date(call.created_at).toLocaleString()}`);
      setPlayerOpen(true);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Recording not available');
    }
  };

  const handleViewTranscript = async (call) => {
    if (!canUseCallMedia(call)) {
      toast.error('Transcript is available only for answered calls');
      return;
    }
    setTranscriptOpen(true);
    setTranscriptLoading(true);
    try {
      const res = await callsAPI.transcript(call.id);
      setTranscriptData(res.data);
    } catch (err) {
      setTranscriptData(null);
      toast.error(err.response?.data?.detail || 'Transcript not available');
    } finally {
      setTranscriptLoading(false);
    }
  };

  const handleDownload = async (call) => {
    if (!canUseCallMedia(call)) {
      toast.error('Download is available only for answered calls');
      return;
    }
    try {
      const res = await callsAPI.download(call.id);
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `call_recording_${call.id}.wav`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Unable to download recording');
    }
  };

  useEffect(() => {
    return () => {
      if (playerUrl) URL.revokeObjectURL(playerUrl);
    };
  }, [playerUrl]);

  return (
    <div className="flex-col gap-6">
      <div className="page-header">
        <div>
          <h2 className="page-title">Call Logs</h2>
          <p className="page-subtitle">Listen to recordings and analyze AI conversations</p>
        </div>
        <div className="flex gap-3">
          <div className="stat-card" style={{ padding: '8px 16px', margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <BarChart size={18} className="text-muted" />
            <div style={{ fontSize: 13 }}>Total Duration: <b>{totalDurationHours} hrs</b></div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="search-bar">
          <div className="input-with-icon" style={{ flex: 1 }}>
            <Search className="input-icon" />
            <input type="text" className="input" placeholder="Search by phone number or Lead ID..." />
          </div>
          <button className="btn btn-secondary">
            <Filter size={18} /> Filters
          </button>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Direction</th>
                <th>From / To</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Date & Time</th>
                <th>Recording</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(3).fill(0).map((_, i) => (
                  <tr key={i}><td colSpan="6"><div className="skeleton" style={{ height: '40px' }} /></td></tr>
                ))
              ) : (
                calls.map((call) => (
                  (() => {
                    const statusUI = getCallStatusUI(call.status);
                    const mediaEnabled = canUseCallMedia(call);
                    return (
                  <tr key={call.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        {call.direction === 'inbound' ? 
                          <span className="badge badge-inbound"><PhoneIncoming size={14} /> Inbound</span> : 
                          <span className="badge badge-outbound"><PhoneOutgoing size={14} /> Outbound</span>
                        }
                      </div>
                    </td>
                    <td>
                      <div className="text-sm font-bold">{call.direction === 'inbound' ? call.from_number : call.to_number}</div>
                      <div className="text-xs text-muted">via {call.direction === 'inbound' ? call.to_number : call.from_number}</div>
                    </td>
                    <td>
                      <span className={`badge ${statusUI.badge}`}>
                        {statusUI.label}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2 text-sm">
                        <Clock size={14} className="text-muted" />
                        {Math.floor(call.duration_seconds / 60)}m {call.duration_seconds % 60}s
                      </div>
                    </td>
                    <td><span className="text-xs text-muted">{new Date(call.created_at).toLocaleString()}</span></td>
                    <td>
                      {mediaEnabled ? (
                        <div className="flex gap-2">
                          <button className="btn btn-icon btn-sm btn-secondary" title="Play Recording" onClick={() => handlePlay(call)}>
                            <Play size={14} />
                          </button>
                          <button className="btn btn-icon btn-sm btn-secondary" title="View Transcript" onClick={() => handleViewTranscript(call)}>
                            <Eye size={14} />
                          </button>
                          <button className="btn btn-icon btn-sm btn-secondary" title="Download Recording" onClick={() => handleDownload(call)}>
                            <Download size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button className="btn btn-icon btn-sm btn-secondary" title="Blocked: answered call required" disabled style={{ opacity: 0.45, cursor: 'not-allowed' }}>
                            <Play size={14} />
                          </button>
                          <button className="btn btn-icon btn-sm btn-secondary" title="Blocked: answered call required" disabled style={{ opacity: 0.45, cursor: 'not-allowed' }}>
                            <Eye size={14} />
                          </button>
                          <button className="btn btn-icon btn-sm btn-secondary" title="Blocked: answered call required" disabled style={{ opacity: 0.45, cursor: 'not-allowed' }}>
                            <Download size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                    );
                  })()
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center mt-6">
          <span className="text-xs text-muted">Page {page} of {Math.ceil(total / 10) || 1}</span>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm btn-icon" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={16} />
            </button>
            <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setPage(p => p + 1)}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {playerOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 640 }}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="chart-title">Play Recording</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setPlayerOpen(false)}>Close</button>
            </div>
            <p className="text-xs text-muted mb-3">{playerTitle}</p>
            <audio controls style={{ width: '100%' }} src={playerUrl} autoPlay />
          </div>
        </div>
      )}

      {transcriptOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 760, maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="chart-title">Questions & Candidate Answers</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setTranscriptOpen(false)}>Close</button>
            </div>
            {transcriptLoading ? (
              <div className="skeleton" style={{ height: 120 }} />
            ) : transcriptData?.transcript ? (
              <div className="p-4 rounded border" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="text-xs text-muted mb-2">Transcript</div>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{transcriptData.transcript}</p>
              </div>
            ) : !transcriptData || !transcriptData.qa || transcriptData.qa.length === 0 ? (
              <p className="text-sm text-muted">No transcript found for this call.</p>
            ) : (
              <div className="flex-col gap-3">
                {transcriptData.qa.map((item, idx) => (
                  <div key={idx} className="p-4 rounded border" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="text-xs text-muted mb-2">Q{idx + 1}</div>
                    <p style={{ fontWeight: 600 }}>{item.question || 'Question unavailable'}</p>
                    <div className="text-xs text-muted mt-3 mb-2">Candidate Answer</div>
                    <p>{item.answer || '--'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
