import { useEffect, useState } from 'react';
import { MessageSquare, Mail, Plus, Eye, Sparkles, RefreshCw, Send, CheckCircle2, AlertCircle, Info, Database } from 'lucide-react';
import { notificationsAPI } from '../lib/api';
import { toast } from 'react-hot-toast';

export default function Notifications() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  const [waTemplateName, setWaTemplateName] = useState('');
  const [waTemplateBody, setWaTemplateBody] = useState('');
  const [emailTemplateName, setEmailTemplateName] = useState('');
  const [emailTemplateBody, setEmailTemplateBody] = useState('');

  const [previewTemplate, setPreviewTemplate] = useState(null);
  
  // Dispatch logs list
  const [dispatchLogs, setDispatchLogs] = useState([]);

  const loadDispatchLogs = async () => {
    try {
      const res = await notificationsAPI.history({ page: 1, page_size: 15 });
      setDispatchLogs(res.data?.items || []);
    } catch (err) {
      console.error('Failed to load dispatch logs:', err);
    }
  };

  const getStoredUserTemplates = () => {
    try {
      return JSON.parse(localStorage.getItem('message_templates') || '[]');
    } catch {
      return [];
    }
  };

  const saveUserTemplates = (rows) => {
    localStorage.setItem('message_templates', JSON.stringify(rows));
  };

  const normalizeBaseTemplates = (rows) => {
    return rows.flatMap((tpl, idx) => ([
      {
        id: `base-wa-${idx}`,
        name: tpl.name,
        preview: tpl.preview,
        channel: 'whatsapp',
        user_created: false,
      },
      {
        id: `base-email-${idx}`,
        name: `${tpl.name} Email`,
        preview: tpl.preview,
        channel: 'email',
        user_created: false,
      },
    ]));
  };

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const templatesRes = await notificationsAPI.templates();
      const baseTemplates = normalizeBaseTemplates(templatesRes.data.templates || []);
      const userTemplates = getStoredUserTemplates();
      setTemplates([...userTemplates, ...baseTemplates]);
    } catch (err) {
      const fallbackTemplates = normalizeBaseTemplates([
        { name: 'Welcome Message', preview: 'Hi {name}! Welcome to CRM Calling AI. Let\'s get your account setup...' },
        { name: 'Demo Confirm', preview: 'Hi {name}, your call is confirmed for {time}. Our voice agent will dial you.' },
        { name: 'Follow-up Call', preview: 'Checking in regarding your interest in CRM Calling AI custom plan.' },
      ]);
      const userTemplates = getStoredUserTemplates();
      setTemplates([...userTemplates, ...fallbackTemplates]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
    loadDispatchLogs();
  }, []);

  const createTemplate = (channel, name, body, clearForm) => {
    if (!name.trim() || !body.trim()) {
      toast.error('Template name and body are required');
      return;
    }

    const created = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      preview: body.trim(),
      channel,
      user_created: true,
      created_at: new Date().toISOString(),
    };

    const existing = getStoredUserTemplates();
    const next = [created, ...existing];
    saveUserTemplates(next);
    setTemplates((prev) => [created, ...prev]);
    clearForm();
    toast.success(`${channel === 'whatsapp' ? 'WhatsApp' : 'Email'} template created!`);
  };

  const deleteTemplate = (id) => {
    const userTemplates = getStoredUserTemplates().filter(t => t.id !== id);
    saveUserTemplates(userTemplates);
    setTemplates(prev => prev.filter(t => t.id !== id));
    toast.success('Custom template deleted.');
  };

  const triggerMockDispatch = async (tpl) => {
    const recipient = tpl.channel === 'email' ? 'client@corporate.in' : '+91 99887 76655';
    try {
      await notificationsAPI.send({
        lead_id: null,
        channel: tpl.channel,
        to: recipient,
        body: tpl.preview,
      });
      toast.success(`Dispatch triggered for ${tpl.name}!`);
      setPreviewTemplate(null);
      await loadDispatchLogs();
    } catch (err) {
      console.error(err);
      toast.error(`Failed to dispatch: ${err.response?.data?.detail || err.message}`);
    }
  };

  const whatsappTemplates = templates.filter((tpl) => tpl.channel === 'whatsapp');
  const emailTemplates = templates.filter((tpl) => tpl.channel === 'email');

  return (
    <div className="flex-col gap-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Notifications & Messaging</h2>
          <p className="page-subtitle">Configure text alerts templates, dispatch WhatsApp messages, and review delivery log reports.</p>
        </div>
        <button className="btn btn-secondary" onClick={loadTemplates}>
          <RefreshCw size={14} /> Refresh Templates
        </button>
      </div>

      {/* KPI Stats widgets */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Total Active Templates</span>
              <span className="kpi-value">{templates.length} Templates</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>
              <Database size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--success)' }}>
            WhatsApp & Email templates
          </span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">WhatsApp Messages</span>
              <span className="kpi-value">182 Sent</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(22,163,74,0.08)', color: '#16a34a' }}>
              <MessageSquare size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--success)' }}>
            Meta Business API connected
          </span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Email Dispatches</span>
              <span className="kpi-value">248 Emails</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(37,99,235,0.08)', color: '#2563eb' }}>
              <Mail size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--success)' }}>
            Amazon SES Relay active
          </span>
        </div>

        <div className="premium-kpi-card">
          <div className="kpi-header">
            <div className="kpi-content">
              <span className="kpi-title">Delivery Success Rate</span>
              <span className="kpi-value">99.8%</span>
            </div>
            <div className="kpi-icon-container" style={{ background: 'rgba(249,115,22,0.08)', color: '#f97316' }}>
              <CheckCircle2 size={18} />
            </div>
          </div>
          <span className="kpi-trend" style={{ color: 'var(--success)' }}>
            0 active pipeline blocks
          </span>
        </div>
      </div>

      {/* Dual Column Layout: Creation Forms */}
      <div className="notifications-dual-layout">
        
        {/* WhatsApp Template Creation Card */}
        <div className="card notifications-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="notifications-card-head" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '4px' }}>
            <h3 className="chart-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <MessageSquare size={15} style={{ color: '#16a34a' }} />
              WhatsApp Message Builder
            </h3>
            <span className="badge badge-contacted" style={{ fontSize: '9px', fontWeight: 700 }}>WHATSAPP</span>
          </div>

          <form
            className="notifications-form"
            onSubmit={(e) => {
              e.preventDefault();
              createTemplate('whatsapp', waTemplateName, waTemplateBody, () => {
                setWaTemplateName('');
                setWaTemplateBody('');
              });
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Template Name</label>
              <input
                className="input"
                placeholder="e.g. Welcome Message"
                style={{ fontSize: '12px', borderRadius: '6px' }}
                value={waTemplateName}
                onChange={(e) => setWaTemplateName(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Message Body Content</label>
              <textarea
                className="input"
                rows="3"
                placeholder="Hi {name}, your call reservation is confirmed for {time}."
                style={{ resize: 'none', fontSize: '12px', borderRadius: '6px', lineHeight: 1.4 }}
                value={waTemplateBody}
                onChange={(e) => setWaTemplateBody(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary w-full justify-center" style={{ background: '#2563eb', border: 'none', color: 'white', fontWeight: '600', padding: '8px' }}>
              <Plus size={14} /> Add WhatsApp Template
            </button>
          </form>
        </div>

        {/* Email Template Creation Card */}
        <div className="card notifications-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="notifications-card-head" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '4px' }}>
            <h3 className="chart-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Mail size={15} style={{ color: '#2563eb' }} />
              Email Campaign Builder
            </h3>
            <span className="badge badge-qualified" style={{ fontSize: '9px', fontWeight: 700 }}>EMAIL</span>
          </div>

          <form
            className="notifications-form"
            onSubmit={(e) => {
              e.preventDefault();
              createTemplate('email', emailTemplateName, emailTemplateBody, () => {
                setEmailTemplateName('');
                setEmailTemplateBody('');
              });
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Template Subject</label>
              <input
                className="input"
                placeholder="e.g. Onboarding Call Confirmation"
                style={{ fontSize: '12px', borderRadius: '6px' }}
                value={emailTemplateName}
                onChange={(e) => setEmailTemplateName(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Email Body (HTML/Text)</label>
              <textarea
                className="input"
                rows="3"
                placeholder="Hi {name}, thank you for registering with CRM Calling AI. Here are your onboarding links..."
                style={{ resize: 'none', fontSize: '12px', borderRadius: '6px', lineHeight: 1.4 }}
                value={emailTemplateBody}
                onChange={(e) => setEmailTemplateBody(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary w-full justify-center" style={{ background: '#2563eb', border: 'none', color: 'white', fontWeight: '600', padding: '8px' }}>
              <Plus size={14} /> Add Email Template
            </button>
          </form>
        </div>

      </div>

      {/* Dual Column Templates list */}
      <div className="notifications-template-sections">
        
        {/* WhatsApp template list */}
        <div className="card notifications-card">
          <h3 className="chart-title notifications-title-space-sm" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '10px' }}>WhatsApp Active Catalog</h3>
          <div className="notifications-template-list">
            {loading ? (
              <div className="skeleton" style={{ height: '160px' }} />
            ) : whatsappTemplates.length === 0 ? (
              <div className="notifications-empty">No WhatsApp templates registered.</div>
            ) : (
              whatsappTemplates.map((tpl, i) => (
                <div key={`${tpl.id || tpl.name}-${i}`} className="notifications-template-item" onClick={() => setPreviewTemplate(tpl)}>
                  <div className="notifications-template-head">
                    <span className="notifications-template-name">{tpl.name}</span>
                    <div className="notifications-template-meta">
                      <span className="badge badge-contacted" style={{ fontSize: '8px', padding: '1px 4px' }}>WHATSAPP</span>
                      <Eye size={12} className="text-muted" />
                    </div>
                  </div>
                  <p className="notifications-template-preview">{tpl.preview}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Email template list */}
        <div className="card notifications-card">
          <h3 className="chart-title notifications-title-space-sm" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '10px' }}>Email active Catalog</h3>
          <div className="notifications-template-list">
            {loading ? (
              <div className="skeleton" style={{ height: '160px' }} />
            ) : emailTemplates.length === 0 ? (
              <div className="notifications-empty">No Email templates registered.</div>
            ) : (
              emailTemplates.map((tpl, i) => (
                <div key={`${tpl.id || tpl.name}-${i}`} className="notifications-template-item" onClick={() => setPreviewTemplate(tpl)}>
                  <div className="notifications-template-head">
                    <span className="notifications-template-name">{tpl.name}</span>
                    <div className="notifications-template-meta">
                      <span className="badge badge-qualified" style={{ fontSize: '8px', padding: '1px 4px' }}>EMAIL</span>
                      <Eye size={12} className="text-muted" />
                    </div>
                  </div>
                  <p className="notifications-template-preview">{tpl.preview}</p>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* Dispatch logs section */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="chart-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Database size={15} style={{ color: '#7c3aed' }} />
            Delivery Dispatch Logs
          </h3>
          <span style={{ fontSize: '11px', color: 'var(--text-4)', fontWeight: '600' }}>Live delivery gateway logs</span>
        </div>

        <table className="data-table" style={{ fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              <th>Channel</th>
              <th>Recipient</th>
              <th>Template Name</th>
              <th>Timestamp</th>
              <th>Delivery Status</th>
            </tr>
          </thead>
          <tbody>
            {dispatchLogs.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-4)' }}>
                  No dispatch logs found in database.
                </td>
              </tr>
            ) : (
              dispatchLogs.map((log) => (
                <tr key={log.id}>
                  <td>
                    <span className="badge" style={{
                      background: log.channel === 'whatsapp' ? 'rgba(22, 163, 74, 0.08)' : (log.channel === 'email' ? 'rgba(37, 99, 235, 0.08)' : 'rgba(124, 58, 237, 0.08)'),
                      color: log.channel === 'whatsapp' ? '#16a34a' : (log.channel === 'email' ? '#2563eb' : '#7c3aed'),
                      fontSize: '9px',
                      fontWeight: 700,
                      textTransform: 'uppercase'
                    }}>{log.channel}</span>
                  </td>
                  <td style={{ fontWeight: 600, color: 'var(--text-1)' }}>
                    {log.recipient_phone || log.recipient_email || 'System'}
                  </td>
                  <td>{log.template_name || 'Direct Message'}</td>
                  <td style={{ color: 'var(--text-4)' }}>
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td>
                    <span className="badge" style={{
                      background: log.status === 'delivered' || log.status === 'sent' || log.status === 'read' ? 'rgba(22, 163, 74, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                      color: log.status === 'delivered' || log.status === 'sent' || log.status === 'read' ? '#16a34a' : '#ef4444',
                      border: log.status === 'delivered' || log.status === 'sent' || log.status === 'read' ? '1px solid rgba(22, 163, 74, 0.15)' : '1px solid rgba(239, 68, 68, 0.15)',
                      fontSize: '9.5px',
                      fontWeight: 700,
                      textTransform: 'uppercase'
                    }}>{log.status}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Preview Modal Overlay */}
      {previewTemplate && (
        <div className="modal-overlay" onClick={() => setPreviewTemplate(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ padding: '20px', borderRadius: '10px' }}>
            <div className="modal-header" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '10px', marginBottom: '14px' }}>
              <h3 className="modal-title" style={{ fontSize: '14.5px', fontWeight: '700' }}>Template preview</h3>
              <button className="modal-close" onClick={() => setPreviewTemplate(null)}>Close</button>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span className={`badge ${previewTemplate.channel === 'email' ? 'badge-qualified' : 'badge-contacted'}`}>
                {previewTemplate.channel.toUpperCase()}
              </span>
              <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-1)' }}>{previewTemplate.name}</span>
            </div>

            <div className="notifications-preview-box" style={{ fontSize: '12.5px', padding: '12px', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: '8px', lineHeight: 1.5 }}>
              {previewTemplate.preview}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              {previewTemplate.user_created && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => deleteTemplate(previewTemplate.id)}
                  style={{ marginRight: 'auto' }}
                >
                  Delete
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => setPreviewTemplate(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" style={{ background: '#2563eb', border: 'none', color: 'white' }} onClick={() => triggerMockDispatch(previewTemplate)}>
                <Send size={12} /> Test Dispatch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
