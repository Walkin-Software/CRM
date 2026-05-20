/**
 * WhatsApp Chat — shows conversation threads per lead.
 * Lists all leads who have WhatsApp messages, and shows the full thread on click.
 * Agents can send a manual message from here.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { MessageSquare, Send, Search, RefreshCw, CheckCheck, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { format } from 'date-fns';

export default function WhatsAppChat() {
  const [leads, setLeads]         = useState([]);
  const [selected, setSelected]   = useState(null);
  const [messages, setMessages]   = useState([]);
  const [newMsg, setNewMsg]       = useState('');
  const [sending, setSending]     = useState(false);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadingMsgs, setLoadingMsgs]   = useState(false);
  const [search, setSearch]       = useState('');
  const bottomRef                 = useRef(null);

  const loadLeads = useCallback(async () => {
    setLoadingLeads(true);
    try {
      // Get notification history filtered by whatsapp
      const res = await api.get('/notifications/history', { params: { page: 1, page_size: 500 } });
      const allNotifs = res.data.items || [];

      // Group by lead_id
      const byLead = {};
      for (const n of allNotifs) {
        if (n.channel !== 'whatsapp' || !n.lead_id) continue;
        if (!byLead[n.lead_id]) byLead[n.lead_id] = { lastMsg: n, count: 0, lead_id: n.lead_id };
        byLead[n.lead_id].count++;
        if (new Date(n.created_at) > new Date(byLead[n.lead_id].lastMsg.created_at)) {
          byLead[n.lead_id].lastMsg = n;
        }
      }

      // Enrich with lead info
      const leadIds = Object.keys(byLead);
      const enriched = await Promise.allSettled(
        leadIds.map(id => api.get(`/leads/${id}`).then(r => ({ ...byLead[id], lead: r.data })))
      );
      const result = enriched
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value)
        .sort((a, b) => new Date(b.lastMsg.created_at) - new Date(a.lastMsg.created_at));

      setLeads(result);
    } catch {
      toast.error('Failed to load chats');
    } finally {
      setLoadingLeads(false);
    }
  }, []);

  const loadMessages = useCallback(async (leadId) => {
    setLoadingMsgs(true);
    try {
      const res = await api.get('/notifications/history', { params: { page: 1, page_size: 200 } });
      const all = (res.data.items || []).filter(n => n.channel === 'whatsapp' && n.lead_id === leadId);
      all.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      setMessages(all);
    } catch {
      toast.error('Failed to load messages');
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  useEffect(() => {
    if (selected) loadMessages(selected.lead_id);
  }, [selected, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!newMsg.trim() || !selected) return;
    setSending(true);
    try {
      await api.post('/notifications/send', {
        lead_id: selected.lead_id,
        channel: 'whatsapp',
        to: selected.lead?.phone,
        body: newMsg.trim(),
      });
      toast.success('Message sent');
      setNewMsg('');
      await loadMessages(selected.lead_id);
      await loadLeads();
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const filteredLeads = leads.filter(l => {
    const name = (l.lead?.full_name || '').toLowerCase();
    const phone = (l.lead?.phone || '').toLowerCase();
    return name.includes(search.toLowerCase()) || phone.includes(search.toLowerCase());
  });

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 80px)', overflow: 'hidden', gap: 0 }}>
      {/* ── Lead list (left panel) ─────────────────── */}
      <div style={{
        width: 300, flexShrink: 0,
        borderRight: '1px solid var(--border-default)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-elevated)',
      }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              WhatsApp Chats
            </h3>
            <button onClick={loadLeads} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
              <RefreshCw size={14} />
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search leads..."
              style={{
                width: '100%', padding: '7px 10px 7px 30px', borderRadius: 8, border: '1px solid var(--border-default)',
                background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadingLeads ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>
          ) : filteredLeads.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No WhatsApp conversations yet
            </div>
          ) : filteredLeads.map(item => {
            const isActive = selected?.lead_id === item.lead_id;
            const preview = item.lastMsg.content || '';
            const isOutbound = item.lastMsg.status !== 'read';
            return (
              <div
                key={item.lead_id}
                onClick={() => setSelected(item)}
                style={{
                  padding: '12px 16px', cursor: 'pointer',
                  background: isActive ? 'var(--accent-blue)10' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--accent-blue)' : '3px solid transparent',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                    {item.lead?.full_name || item.lead?.phone || 'Unknown'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {format(new Date(item.lastMsg.created_at), 'dd/MM, HH:mm')}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {isOutbound && <CheckCheck size={12} style={{ color: '#4ade80', flexShrink: 0 }} />}
                  {preview.slice(0, 55)}{preview.length > 55 ? '…' : ''}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Chat window (right panel) ─────────────── */}
      {!selected ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexDirection: 'column', gap: 12 }}>
          <MessageSquare size={48} style={{ opacity: 0.2 }} />
          <p style={{ fontSize: 14 }}>Select a conversation</p>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Chat header */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-default)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#4ade8020', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80', fontWeight: 700, fontSize: 16 }}>
              {(selected.lead?.full_name || '?')[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                {selected.lead?.full_name || selected.lead?.phone}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {selected.lead?.phone} · {selected.count} message{selected.count !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loadingMsgs ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading messages...</div>
            ) : messages.map(msg => {
              const isSent = msg.status !== 'read';
              return (
                <div key={msg.id} style={{ display: 'flex', justifyContent: isSent ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '68%', padding: '10px 14px', borderRadius: isSent ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: isSent ? 'var(--accent-blue)' : 'var(--bg-elevated)',
                    border: isSent ? 'none' : '1px solid var(--border-default)',
                    color: isSent ? '#fff' : 'var(--text-primary)',
                    fontSize: 14, lineHeight: 1.5,
                  }}>
                    <p style={{ margin: 0 }}>{msg.content}</p>
                    <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 4, justifyContent: isSent ? 'flex-end' : 'flex-start' }}>
                      <Clock size={9} />
                      {format(new Date(msg.created_at), 'dd/MM HH:mm')}
                      {isSent && msg.status === 'delivered' && <CheckCheck size={10} />}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-default)', background: 'var(--bg-elevated)', display: 'flex', gap: 10 }}>
            <input
              value={newMsg}
              onChange={e => setNewMsg(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="Type a message..."
              disabled={sending}
              style={{
                flex: 1, padding: '10px 14px', borderRadius: 24, border: '1px solid var(--border-default)',
                background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 14,
              }}
            />
            <button
              onClick={sendMessage}
              disabled={sending || !newMsg.trim()}
              style={{
                width: 42, height: 42, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: sending || !newMsg.trim() ? 'var(--bg-base)' : 'var(--accent-blue)',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.2s',
              }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
