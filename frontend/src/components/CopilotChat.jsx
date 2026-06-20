import { useEffect, useRef, useState } from 'react';
import { X, Send, Sparkles, Bot, User } from 'lucide-react';
import { copilotAPI } from '../lib/api';

const WELCOME = {
  role: 'assistant',
  text: 'Hi! I\'m PRAVESHA AI Copilot. Ask me about your leads, calls, follow-ups, or what to do next.',
};

export default function CopilotChat({ open, onClose }) {
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, open]);

  const sendMessage = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const history = nextMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.text }));

      const res = await copilotAPI.chat({
        message: text,
        history: history.slice(0, -1),
      });

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: res.data?.reply || 'No response received.' },
      ]);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: typeof detail === 'string' ? detail : 'Could not reach the AI assistant. Please try again.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="copilot-chat-overlay" onClick={onClose}>
      <div className="copilot-chat-panel" onClick={(e) => e.stopPropagation()}>
        <div className="copilot-chat-header">
          <div className="copilot-chat-header-title">
            <div className="copilot-chat-header-icon">
              <Sparkles size={14} />
            </div>
            <div>
              <div className="copilot-chat-title">PRAVESHA AI Copilot</div>
              <div className="copilot-chat-subtitle">Powered by OpenAI</div>
            </div>
          </div>
          <button type="button" className="copilot-chat-close" onClick={onClose} aria-label="Close chat">
            <X size={16} />
          </button>
        </div>

        <div className="copilot-chat-messages">
          {messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            return (
              <div key={idx} className={`copilot-chat-bubble-row ${isUser ? 'is-user' : 'is-assistant'}`}>
                <div className={`copilot-chat-avatar ${isUser ? 'user' : 'assistant'}`}>
                  {isUser ? <User size={12} /> : <Bot size={12} />}
                </div>
                <div className={`copilot-chat-bubble ${isUser ? 'user' : 'assistant'}`}>
                  {msg.text}
                </div>
              </div>
            );
          })}
          {loading && (
            <div className="copilot-chat-bubble-row is-assistant">
              <div className="copilot-chat-avatar assistant">
                <Bot size={12} />
              </div>
              <div className="copilot-chat-bubble assistant copilot-chat-typing">Thinking...</div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form className="copilot-chat-input-row" onSubmit={sendMessage}>
          <input
            ref={inputRef}
            className="copilot-chat-input"
            placeholder="Ask about leads, calls, follow-ups..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button type="submit" className="copilot-chat-send" disabled={loading || !input.trim()}>
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}
