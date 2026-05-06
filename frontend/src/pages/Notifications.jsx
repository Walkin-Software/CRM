import { useEffect, useState } from 'react';
import { MessageSquare, Mail, Plus, Eye, Sparkles } from 'lucide-react';
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

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const templatesRes = await notificationsAPI.templates();
        const baseTemplates = normalizeBaseTemplates(templatesRes.data.templates || []);
        const userTemplates = getStoredUserTemplates();
        setTemplates([...userTemplates, ...baseTemplates]);
      } catch (err) {
        const fallbackTemplates = normalizeBaseTemplates([
          { name: 'Welcome Message', preview: 'Hi {name}! Welcome to AI Phone Agent...' },
          { name: 'Demo Reminder', preview: 'Reminder: Your demo is scheduled for {time}...' },
          { name: 'Follow-up', preview: 'Checking in regarding your interest in {course}...' },
        ]);
        const userTemplates = getStoredUserTemplates();
        setTemplates([...userTemplates, ...fallbackTemplates]);
      } finally {
        setLoading(false);
      }
    }
    fetchTemplates();
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
    toast.success(`${channel === 'whatsapp' ? 'WhatsApp' : 'Email'} template created`);
  };

  const whatsappTemplates = templates.filter((tpl) => tpl.channel === 'whatsapp');
  const emailTemplates = templates.filter((tpl) => tpl.channel === 'email');

  return (
    <div className="flex-col gap-6">
      <div className="page-header">
        <div>
          <h2 className="page-title">Notifications & Messaging</h2>
          <p className="page-subtitle">Template creation and preview for WhatsApp and Email</p>
        </div>
      </div>

      <div className="notifications-dual-layout">
        <div className="card notifications-card">
          <div className="notifications-card-head">
            <h3 className="chart-title">WhatsApp</h3>
            <span className="badge badge-contacted"><MessageSquare size={12} /> CHAT</span>
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
            <div className="notifications-card-head" style={{ marginBottom: 0 }}>
              <h4 className="chart-title" style={{ fontSize: 14 }}>Create WhatsApp Template</h4>
              <div className="live-badge"><Sparkles size={12} /> Reusable</div>
            </div>
            <input
              className="input"
              placeholder="Template name"
              value={waTemplateName}
              onChange={(e) => setWaTemplateName(e.target.value)}
            />
            <textarea
              className="input"
              rows="3"
              placeholder="Hi {name}, your demo is confirmed for {date}."
              style={{ resize: 'none' }}
              value={waTemplateBody}
              onChange={(e) => setWaTemplateBody(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary w-full justify-center">
              <Plus size={14} /> Add WhatsApp Template
            </button>
          </form>
        </div>

        <div className="card notifications-card">
          <div className="notifications-card-head">
            <h3 className="chart-title">Email</h3>
            <span className="badge badge-qualified"><Mail size={12} /> MAIL</span>
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
            <div className="notifications-card-head" style={{ marginBottom: 0 }}>
              <h4 className="chart-title" style={{ fontSize: 14 }}>Create Email Template</h4>
              <div className="live-badge"><Sparkles size={12} /> Reusable</div>
            </div>
            <input
              className="input"
              placeholder="Template name"
              value={emailTemplateName}
              onChange={(e) => setEmailTemplateName(e.target.value)}
            />
            <textarea
              className="input"
              rows="3"
              placeholder={'Hi {name},\n\nThank you for your interest.\n\nRegards,\nTeam'}
              style={{ resize: 'none' }}
              value={emailTemplateBody}
              onChange={(e) => setEmailTemplateBody(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary w-full justify-center">
              <Plus size={14} /> Add Email Template
            </button>
          </form>
        </div>
      </div>

      <div className="notifications-template-sections">
        <div className="card notifications-card">
          <h3 className="chart-title notifications-title-space-sm">WhatsApp Templates</h3>
          <div className="notifications-template-list">
            {loading ? (
              <div className="skeleton" style={{ height: '160px' }} />
            ) : whatsappTemplates.length === 0 ? (
              <div className="notifications-empty">No WhatsApp templates yet.</div>
            ) : (
              whatsappTemplates.map((tpl, i) => (
                <div key={`${tpl.id || tpl.name}-${i}`} className="notifications-template-item" onClick={() => setPreviewTemplate(tpl)}>
                  <div className="notifications-template-head">
                    <span className="notifications-template-name">{tpl.name}</span>
                    <div className="notifications-template-meta">
                      <span className="badge badge-contacted">WHATSAPP</span>
                      <Eye size={14} className="text-muted" />
                    </div>
                  </div>
                  <p className="notifications-template-preview">{tpl.preview}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card notifications-card">
          <h3 className="chart-title notifications-title-space-sm">Email Templates</h3>
          <div className="notifications-template-list">
            {loading ? (
              <div className="skeleton" style={{ height: '160px' }} />
            ) : emailTemplates.length === 0 ? (
              <div className="notifications-empty">No Email templates yet.</div>
            ) : (
              emailTemplates.map((tpl, i) => (
                <div key={`${tpl.id || tpl.name}-${i}`} className="notifications-template-item" onClick={() => setPreviewTemplate(tpl)}>
                  <div className="notifications-template-head">
                    <span className="notifications-template-name">{tpl.name}</span>
                    <div className="notifications-template-meta">
                      <span className="badge badge-qualified">EMAIL</span>
                      <Eye size={14} className="text-muted" />
                    </div>
                  </div>
                  <p className="notifications-template-preview">{tpl.preview}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {previewTemplate && (
        <div className="modal-overlay" onClick={() => setPreviewTemplate(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Template Preview</h3>
              <button className="modal-close" onClick={() => setPreviewTemplate(null)}>Close</button>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <span className={`badge ${previewTemplate.channel === 'email' ? 'badge-qualified' : 'badge-contacted'}`}>
                {(previewTemplate.channel || 'unknown').toUpperCase()}
              </span>
              <span style={{ fontWeight: 700 }}>{previewTemplate.name}</span>
            </div>
            <div className="notifications-preview-box">{previewTemplate.preview}</div>
            <div className="flex gap-2" style={{ marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setPreviewTemplate(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
