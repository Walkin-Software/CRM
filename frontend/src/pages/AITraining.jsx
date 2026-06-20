import { useState, useEffect, useRef } from 'react';
import { Brain, Sparkles, Send, Upload, Database, Settings, ShieldAlert, Cpu, Bot, User, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { aiTrainingAPI } from '../lib/api';

export default function AITraining() {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hello! I am CRM Calling AI. Test my knowledge base here.' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const fileInputRef = useRef(null);

  const [configLoading, setConfigLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [temp, setTemp] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(512);
  const [systemPrompt, setSystemPrompt] = useState('You are an expert CRM sales assistant called CRM Calling AI. Be concise and professional.');
  const [selectedModel, setSelectedModel] = useState('gpt-4o-mini');

  const loadDocs = async () => {
    setDocsLoading(true);
    try {
      const res = await aiTrainingAPI.documents.list();
      const payload = res.data;
      const nextDocs = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.documents)
          ? payload.documents
          : Array.isArray(payload?.items)
            ? payload.items
            : [];
      setDocs(nextDocs);
    } catch { toast.error('Failed to load knowledge documents.'); }
    finally { setDocsLoading(false); }
  };

  const loadConfig = async () => {
    setConfigLoading(true);
    try {
      const res = await aiTrainingAPI.config.get();
      const cfg = res.data || {};
      if (cfg.system_prompt) setSystemPrompt(cfg.system_prompt);
      if (cfg.temperature !== undefined) setTemp(cfg.temperature);
      if (cfg.max_tokens !== undefined) setMaxTokens(cfg.max_tokens);
      if (cfg.model) setSelectedModel(cfg.model);
    } catch {} finally { setConfigLoading(false); }
  };

  useEffect(() => { loadDocs(); loadConfig(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const userMsg = { role: 'user', text: chatInput.trim() };
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await aiTrainingAPI.chat({ message: userMsg.text, history: messages.slice(-6) });
      setMessages(prev => [...prev, { role: 'assistant', text: res.data?.reply || res.data?.message || '...' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Error contacting AI. Check backend.' }]);
    } finally { setChatLoading(false); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ['.pdf', '.txt', '.csv', '.docx'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) { toast.error('Only PDF, TXT, CSV or DOCX files are supported.'); return; }
    const formData = new FormData();
    formData.append('file', file);
    const tempDoc = { id: `temp-${Date.now()}`, name: file.name, status: 'uploading', file_size_bytes: file.size };
    setDocs(prev => [tempDoc, ...prev]);
    try {
      const res = await aiTrainingAPI.documents.upload(formData);
      setDocs(prev => prev.map(d => d.id === tempDoc.id ? res.data : d));
      toast.success(`${file.name} uploaded!`);
    } catch {
      setDocs(prev => prev.filter(d => d.id !== tempDoc.id));
      toast.error('Upload failed.');
    } finally { e.target.value = ''; }
  };

  const handleDeleteDoc = async (doc) => {
    if (!window.confirm(`Remove "${doc.name}"?`)) return;
    try {
      await aiTrainingAPI.documents.delete(doc.id);
      setDocs(prev => prev.filter(d => d.id !== doc.id));
      toast.success(`${doc.name} removed.`);
    } catch { toast.error('Failed to remove.'); }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      await aiTrainingAPI.config.save({ system_prompt: systemPrompt, temperature: temp, max_tokens: maxTokens, model: selectedModel });
      toast.success('AI configuration saved!');
    } catch { toast.error('Failed to save config.'); }
    finally { setSavingConfig(false); }
  };

  const formatSize = (b) => !b ? '—' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`;
  const statusColor = { trained: '#16a34a', uploading: '#f97316', training: '#2563eb', failed: '#ef4444' };

  return (
    <div className="flex-col gap-6">
      <div className="page-header">
        <div>
          <h2 className="page-title">AI Training Center</h2>
          <p className="page-subtitle">Configure model variables, upload corporate knowledge bases, and test conversational agent behaviors.</p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 520, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 12 }}>
            <Cpu size={16} style={{ color: '#7c3aed' }} />
            <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>AI Agent Sandbox</h3>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((msg, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: msg.role === 'user' ? '#2563eb' : '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {msg.role === 'user' ? <User size={13} color="#fff" /> : <Bot size={13} color="#fff" />}
                </div>
                <div style={{ maxWidth: '78%', background: msg.role === 'user' ? 'rgba(37,99,235,0.08)' : 'var(--bg-2)', borderRadius: 8, padding: '8px 11px', fontSize: 12, lineHeight: 1.5 }}>
                  {msg.text}
                </div>
              </div>
            ))}
            {chatLoading && <div style={{ fontSize: 12, color: 'var(--text-4)', fontStyle: 'italic', paddingLeft: 36 }}>Thinking...</div>}
            <div ref={chatEndRef} />
          </div>
          <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <input className="input" style={{ flex: 1, fontSize: 12 }} placeholder="Ask the AI agent..." value={chatInput} onChange={e => setChatInput(e.target.value)} disabled={chatLoading} />
            <button className="btn btn-primary btn-sm" type="submit" disabled={chatLoading || !chatInput.trim()}><Send size={12} /></button>
          </form>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 520, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Database size={16} style={{ color: '#2563eb' }} />
              <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>Knowledge Base</h3>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-secondary btn-sm" onClick={loadDocs}><RefreshCw size={12} /></button>
              <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()}><Upload size={12} /> Upload</button>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf,.txt,.csv,.docx" style={{ display: 'none' }} onChange={handleFileUpload} />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {docsLoading ? <div style={{ textAlign: 'center', color: 'var(--text-4)', fontSize: 12, marginTop: 40 }}>Loading...</div>
              : !Array.isArray(docs) || docs.length === 0 ? <div style={{ textAlign: 'center', color: 'var(--text-4)', fontSize: 12, marginTop: 40 }}>No documents yet. Upload a PDF, TXT, CSV or DOCX.</div>
              : docs.map(doc => (
                <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 6, background: 'var(--bg-2)', marginBottom: 6 }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 170 }}>{doc.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{formatSize(doc.file_size_bytes)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: `${statusColor[doc.status] || '#64748b'}18`, color: statusColor[doc.status] || '#64748b' }}>{doc.status}</span>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2 }} onClick={() => handleDeleteDoc(doc)}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 520, padding: 16, gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
            <Settings size={16} style={{ color: '#f97316' }} />
            <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>AI Config Variables</h3>
          </div>
          {configLoading ? <div style={{ textAlign: 'center', color: 'var(--text-4)', fontSize: 12, marginTop: 40 }}>Loading config...</div> : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Model</label>
                <select className="input" style={{ width: '100%', fontSize: 12 }} value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>
                  <option value="gpt-4o-mini">gpt-4o-mini (fast)</option>
                  <option value="gpt-4o">gpt-4o (smart)</option>
                  <option value="gpt-3.5-turbo">gpt-3.5-turbo (legacy)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Temperature: {temp}</label>
                <input type="range" min="0" max="1" step="0.05" value={temp} onChange={e => setTemp(parseFloat(e.target.value))} style={{ width: '100%' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-4)' }}><span>Precise (0)</span><span>Creative (1)</span></div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Max Tokens: {maxTokens}</label>
                <input type="range" min="128" max="2048" step="64" value={maxTokens} onChange={e => setMaxTokens(parseInt(e.target.value))} style={{ width: '100%' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-4)' }}><span>128</span><span>2048</span></div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>System Prompt</label>
                <textarea className="input" style={{ width: '100%', fontSize: 12, minHeight: 120, resize: 'vertical' }} value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} />
              </div>
              <button className="btn btn-primary" onClick={handleSaveConfig} disabled={savingConfig}>{savingConfig ? 'Saving...' : 'Save Configuration'}</button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
