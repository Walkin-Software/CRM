import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ChevronLeft, Phone, MessageSquare, 
  Calendar, CreditCard, Clock, 
  Plus, Send, History, User, ArrowUpRight
} from 'lucide-react';
import { leadsAPI, callsAPI, notificationsAPI, aiAPI } from '../lib/api';
import { toast } from 'react-hot-toast';

export default function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [notes, setNotes] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [calls, setCalls] = useState([]);
  const [screeningSession, setScreeningSession] = useState(null);
  const [answers, setAnswers] = useState(['', '', '']);
  const [audioFile, setAudioFile] = useState(null);
  const [savingScreening, setSavingScreening] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [leadRes, notesRes, fuRes, callsRes] = await Promise.all([
          leadsAPI.get(id),
          leadsAPI.notes.list(id),
          leadsAPI.followUps.list(id),
          callsAPI.list({ lead_id: id, page_size: 5 })
        ]);
        setLead(leadRes.data);
        setNotes(notesRes.data);
        setFollowUps(fuRes.data);
        setCalls(callsRes.data.items || []);
        try {
          const latest = await aiAPI.latestScreening(id);
          setScreeningSession(latest.data);
          setAnswers((latest.data.answers || ['', '', '']).slice(0, 3));
        } catch {
          setScreeningSession(null);
        }
      } catch (err) {
        toast.error('Failed to load lead details');
        navigate('/leads');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    try {
      const { data } = await leadsAPI.notes.create(id, { content: newNote });
      setNotes([data, ...notes]);
      setNewNote('');
      toast.success('Note added');
    } catch (err) {
      toast.error('Failed to add note');
    }
  };

  const handleCall = async () => {
    try {
      toast.loading(`Initiating AI call...`, { id: 'call-detail' });
      await callsAPI.outbound({ lead_id: id, to_number: lead.phone });
      toast.success('AI Agent is calling!', { id: 'call-detail' });
    } catch (err) {
      toast.error('Failed to start call', { id: 'call-detail' });
    }
  };

  const handleMessage = async () => {
    try {
      toast.loading(`Generating and sending AI message...`, { id: 'msg-detail' });
      await notificationsAPI.generateAndSend({ lead_id: id });
      toast.success('AI message sent!', { id: 'msg-detail' });
    } catch (err) {
      toast.error('Failed to send message', { id: 'msg-detail' });
    }
  };

  const handleStartScreening = async () => {
    try {
      toast.loading('Generating 3 AI screening questions...', { id: 'screen-start' });
      const { data } = await aiAPI.startScreening(id);
      setScreeningSession({ ...data, answers: [] });
      setAnswers(['', '', '']);
      toast.success('Questions ready', { id: 'screen-start' });
    } catch {
      toast.error('Failed to generate questions', { id: 'screen-start' });
    }
  };

  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleSubmitScreening = async () => {
    if (!screeningSession?.session_id && !screeningSession?.id) return;
    if (answers.some((a) => !a.trim())) {
      toast.error('Please answer all 3 questions');
      return;
    }

    setSavingScreening(true);
    try {
      let audio_base64;
      let audio_mime;
      if (audioFile) {
        audio_base64 = await fileToBase64(audioFile);
        audio_mime = audioFile.type || 'audio/webm';
      }
      const sessionId = screeningSession.session_id || screeningSession.id;
      const { data } = await aiAPI.submitScreening(sessionId, {
        answers,
        audio_base64,
        audio_mime,
      });
      setScreeningSession(data);
      toast.success('Screening answers and audio saved');
    } catch {
      toast.error('Failed to submit screening');
    } finally {
      setSavingScreening(false);
    }
  };

  if (loading) return <div className="skeleton" style={{ height: '500px' }} />;

  return (
    <div className="flex-col gap-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/leads')} className="btn btn-icon btn-secondary">
          <ChevronLeft size={20} />
        </button>
        <div>
          <h2 className="page-title">{lead.full_name}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className={`badge badge-${lead.status}`}>{lead.status.replace('_', ' ')}</span>
            <span className="text-xs text-muted">ID: {lead.id.substring(0, 8)}</span>
          </div>
        </div>
        <div className="flex gap-3" style={{ marginLeft: 'auto' }}>
          <button className="btn btn-secondary">
            <Calendar size={18} /> Schedule
          </button>
          <button className="btn btn-secondary">
            <CreditCard size={18} /> Payment
          </button>
          <button onClick={handleCall} className="btn btn-primary">
            <Phone size={18} /> Start AI Call
          </button>
        </div>
      </div>

      <div className="charts-grid">
        <div className="flex-col gap-6">
          {/* ── Lead Info Card ────────────────────────────── */}
          <div className="card">
            <h3 className="chart-title mb-4">Contact Information</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div className="input-group">
                <span className="text-xs text-muted font-bold">PHONE NUMBER</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Phone size={14} className="text-muted" />
                  <span>{lead.phone}</span>
                </div>
              </div>
              <div className="input-group">
                <span className="text-xs text-muted font-bold">EMAIL ADDRESS</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <User size={14} className="text-muted" />
                  <span>{lead.email || 'Not provided'}</span>
                </div>
              </div>
              <div className="input-group">
                <span className="text-xs text-muted font-bold">INTEREST</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <History size={14} className="text-muted" />
                  <span>{lead.interest || 'General Inquiry'}</span>
                </div>
              </div>
              <div className="input-group">
                <span className="text-xs text-muted font-bold">SOURCE</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Clock size={14} className="text-muted" />
                  <span className="truncate">{lead.source.replace('_', ' ')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Notes ─────────────────────────────────────── */}
          <div className="card">
            <h3 className="chart-title mb-4">Notes & Activity</h3>
            <form onSubmit={handleAddNote} className="mb-6">
              <div className="flex gap-3">
                <input 
                  className="input" 
                  placeholder="Type a note or activity update..." 
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
                <button type="submit" className="btn btn-primary">
                  <Plus size={18} />
                </button>
              </div>
            </form>

            <div className="flex-col gap-4">
              {notes.map((note) => (
                <div key={note.id} className="flex gap-4 p-4 rounded" style={{ background: 'var(--bg-elevated)' }}>
                  <div className="avatar" style={{ width: 32, height: 32 }}>{note.author?.full_name[0] || 'A'}</div>
                  <div style={{ flex: 1 }}>
                    <div className="flex justify-between items-center mb-1">
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{note.author?.full_name || 'System AI'}</span>
                      <span className="text-xs text-muted">{new Date(note.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{note.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="chart-title mb-4">AI Screening (3 Questions)</h3>
            {!screeningSession?.questions ? (
              <button className="btn btn-primary" onClick={handleStartScreening}>
                Generate AI Questions
              </button>
            ) : (
              <div className="flex-col gap-4">
                {screeningSession.questions.map((question, idx) => (
                  <div key={idx} className="input-group">
                    <label className="input-label">Q{idx + 1}. {question}</label>
                    <textarea
                      className="input"
                      rows="3"
                      value={answers[idx] || ''}
                      onChange={(e) => {
                        const updated = [...answers];
                        updated[idx] = e.target.value;
                        setAnswers(updated);
                      }}
                    />
                  </div>
                ))}
                <div className="input-group">
                  <label className="input-label">Candidate Audio (Optional)</label>
                  <input type="file" accept="audio/*" className="input" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} />
                </div>
                <button className="btn btn-primary" onClick={handleSubmitScreening} disabled={savingScreening}>
                  {savingScreening ? 'Saving...' : 'Save Answers + Audio'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-col gap-6">
          {/* ── Follow-ups ────────────────────────────────── */}
          <div className="card">
            <h3 className="chart-title mb-4">Upcoming Follow-ups</h3>
            <div className="flex-col gap-3">
              {followUps.length === 0 ? (
                <p className="text-sm text-muted">No scheduled follow-ups.</p>
              ) : (
                followUps.map((fu) => (
                  <div key={fu.id} className="flex items-center gap-3 p-3 border rounded" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div style={{ 
                      width: 36, height: 36, borderRadius: 8, 
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(99,102,241,0.1)', color: '#6366f1'
                    }}>
                      {fu.method === 'call' ? (
                        <Phone size={18} onClick={handleCall} style={{ cursor: 'pointer' }} />
                      ) : (
                        <MessageSquare size={18} onClick={handleMessage} style={{ cursor: 'pointer' }} />
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{fu.method.toUpperCase()}</div>
                      <div className="text-xs text-muted">{new Date(fu.scheduled_at).toLocaleDateString()}</div>
                    </div>
                    <input type="checkbox" checked={fu.is_completed} readOnly />
                  </div>
                ))
              )}
              <button className="btn btn-secondary btn-sm w-full mt-2">
                <Plus size={14} /> Schedule Follow-up
              </button>
            </div>
          </div>

          {/* ── Call History ──────────────────────────────── */}
          <div className="card">
            <h3 className="chart-title mb-4">Call History</h3>
            <div className="flex-col gap-3">
              {calls.length === 0 ? (
                <p className="text-sm text-muted">No call logs yet.</p>
              ) : calls.map((call) => (
                <div key={call.id} className="flex justify-between items-center p-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center gap-3">
                    <History size={16} className="text-muted" />
                    <div>
                      <div className="text-sm font-bold">{call.direction} AI Call</div>
                      <div className="text-xs text-muted">{new Date(call.created_at).toLocaleString()} • {Math.floor((call.duration_seconds || 0) / 60)}m {(call.duration_seconds || 0) % 60}s</div>
                    </div>
                  </div>
                  <button className="btn btn-icon btn-sm" style={{ background: 'var(--bg-elevated)' }}>
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              ))}
              <button className="btn btn-secondary btn-sm w-full mt-2">View Full Logs</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
