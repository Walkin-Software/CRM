import { useState, useEffect, useRef } from 'react';
import {
  Brain, Sparkles, Settings, Bot, Trash2, Plus, Save,
  ChevronDown, ChevronUp, MessageSquare, RotateCcw
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { aiTrainingAPI } from '../lib/api';

// ── Prompt builder ─────────────────────────────────────────────
// All values come from DB / user input. No hardcoded defaults.
function buildSystemPrompt({ agentName, agentLanguage, agentCompany, companyDesc, companyHQ, companyBranches, firstMessage, wrapUp, rules }) {
  const name    = (agentName    || '').trim();
  const lang    = (agentLanguage|| '').trim();
  const company = (agentCompany || '').trim();
  const desc    = (companyDesc  || '').trim();
  const hq      = (companyHQ    || '').trim();
  const branches= (companyBranches || '').trim();
  const fm      = (firstMessage || '').trim();
  const wu      = (wrapUp       || '').trim();

  const rulesBlock = (rules || [])
    .filter(r => r.trim())
    .map(r => `- ${r.trim()}`)
    .join('\n') || '- Be professional and courteous.';

  const hqLine = hq || branches
    ? `Our head office is in ${hq || '—'}${branches ? `, and we have branches in ${branches}` : ''}.`
    : '';

  return `[Identity]
You are ${name}, a professional and courteous AI assistant from ${company} who speaks in ${lang}.

[Call Flow]
1. Opening line:
   "${fm}" < wait for user response >

2. Company Introduction:
   This is regarding ${company}. ${desc}${desc && !desc.endsWith('.') ? '.' : ''} ${hqLine} Are you interested in this opportunity? < wait for response >

3. Dynamic Screening Questions:
   - Ask the screening / qualification questions one by one, acknowledge briefly, then ask the next.
   <Dynamic questions will be injected here during the call based on candidate interest>

4. Wrap-Up:
   "${wu}"

Rules:
${rulesBlock}

[Error Handling / Fallback]
- If any response is unclear, say "I was not able to capture you, could you please say it again?"
- If the candidate prefers not to answer, acknowledge and move on politely.`;
}

// Inject updated rules into an existing (possibly manually edited) prompt string
// Uses regex with multiple fallback patterns to handle prompts saved in any format.
function injectRulesIntoPrompt(existingPrompt, rules) {
  const rulesBlock = (rules || [])
    .filter(r => r.trim())
    .map(r => `- ${r.trim()}`)
    .join('\n') || '- Be professional and courteous.';

  // Pattern 1: Rules section between "Rules:" and next "[" section
  if (/\nRules:\n[\s\S]*?(?=\n\[)/.test(existingPrompt)) {
    return existingPrompt.replace(
      /\nRules:\n[\s\S]*?(?=\n\[)/,
      `\nRules:\n${rulesBlock}\n`
    );
  }
  // Pattern 2: Rules section between "Rules:" and end of string
  if (/\nRules:\n[\s\S]*$/.test(existingPrompt)) {
    return existingPrompt.replace(
      /\nRules:\n[\s\S]*$/,
      `\nRules:\n${rulesBlock}`
    );
  }
  // Pattern 3: "Rules:" at start of line
  if (/^Rules:/m.test(existingPrompt)) {
    return existingPrompt.replace(
      /^Rules:[\s\S]*?(?=^\[|$)/m,
      `Rules:\n${rulesBlock}\n`
    );
  }
  // Fallback: append rules section
  return existingPrompt + `\n\nRules:\n${rulesBlock}`;
}

// Inject updated identity into an existing prompt string
function injectIdentityIntoPrompt(existingPrompt, { agentName, agentCompany, agentLanguage }) {
  const name    = (agentName    || '').trim();
  const lang    = (agentLanguage|| '').trim();
  const company = (agentCompany || '').trim();

  const newIdentity = `[Identity]\nYou are ${name}, a professional and courteous AI assistant from ${company} who speaks in ${lang}.`;

  const regex = /(^|\n)\[Identity\][\s\S]*?(?=\n\s*(?:\[Call Flow\]|1\.|2\.|3\.|4\.|Rules:|\[Error|$))/;
  if (regex.test(existingPrompt)) {
    return existingPrompt.replace(regex, (match, p1) => `${p1}${newIdentity}`);
  }
  return existingPrompt;
}

// Inject updated opening line into an existing prompt string
function injectOpeningLineIntoPrompt(existingPrompt, firstMessage) {
  const fm = (firstMessage || '').trim();
  const newOpening = `1. Opening line:\n   "${fm}" < wait for user response >`;

  const regex = /(^|\n)1\.\s*Opening line:[\s\S]*?(?=\n\s*(?:2\.|3\.|4\.|Rules:|\[Error|$))/;
  if (regex.test(existingPrompt)) {
    return existingPrompt.replace(regex, (match, p1) => `${p1}${newOpening}`);
  }
  return existingPrompt;
}

// Inject updated company introduction into an existing prompt string
function injectCompanyIntroIntoPrompt(existingPrompt, { agentCompany, companyDesc, companyHQ, companyBranches }) {
  const company = (agentCompany || '').trim();
  const desc    = (companyDesc  || '').trim();
  const hq      = (companyHQ    || '').trim();
  const branches= (companyBranches || '').trim();
  const hqLine = hq || branches
    ? `Our head office is in ${hq || '—'}${branches ? `, and we have branches in ${branches}` : ''}.`
    : '';

  const newIntro = `2. Company Introduction:\n   This is regarding ${company}. ${desc}${desc && !desc.endsWith('.') ? '.' : ''} ${hqLine} Are you interested in this opportunity? < wait for response >`;

  const regex = /(^|\n)2\.\s*Company Introduction:[\s\S]*?(?=\n\s*(?:3\.|4\.|Rules:|\[Error|$))/;
  if (regex.test(existingPrompt)) {
    return existingPrompt.replace(regex, (match, p1) => `${p1}${newIntro}`);
  }
  return existingPrompt;
}

// Inject updated wrap-up into an existing prompt string
function injectWrapUpIntoPrompt(existingPrompt, wrapUp) {
  const wu = (wrapUp || '').trim();
  const newWrapUp = `4. Wrap-Up:\n   "${wu}"`;

  const regex = /(^|\n)4\.\s*Wrap-Up:[\s\S]*?(?=\n\s*(?:Rules:|\[Error|$))/;
  if (regex.test(existingPrompt)) {
    return existingPrompt.replace(regex, (match, p1) => `${p1}${newWrapUp}`);
  }
  return existingPrompt;
}

// ── Section collapsible ───────────────────────────────────────
function Section({ icon: Icon, color, title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: open ? 16 : 0 }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 0', color: 'var(--text-1)' }}>
        <Icon size={14} style={{ color }} />
        <span style={{ fontSize: 12, fontWeight: 700, flex: 1, textAlign: 'left' }}>{title}</span>
        {open ? <ChevronUp size={13} style={{ color: 'var(--text-4)' }} /> : <ChevronDown size={13} style={{ color: 'var(--text-4)' }} />}
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function DynamicList({ items, onChange, placeholder, addLabel }) {
  const add    = () => onChange([...items, '']);
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const update = (i, val) => onChange(items.map((it, idx) => idx === i ? val : it));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <textarea className="input" rows={2} style={{ flex: 1, fontSize: 12, resize: 'vertical', minHeight: 38 }} placeholder={`${placeholder} ${i + 1}`} value={item} onChange={e => update(i, e.target.value)} />
          <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '6px 2px', flexShrink: 0 }}><Trash2 size={13} /></button>
        </div>
      ))}
      <button onClick={add} className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start', fontSize: 11, gap: 4, display: 'flex', alignItems: 'center' }}>
        <Plus size={11} /> {addLabel}
      </button>
    </div>
  );
}

export default function AITraining() {
  // ── Builder state — all blank by default, loaded from DB ──────
  const [agentName,       setAgentName]       = useState('');
  const [agentLanguage,   setAgentLanguage]   = useState('');
  const [agentCompany,    setAgentCompany]    = useState('');
  const [companyDesc,     setCompanyDesc]     = useState('');
  const [companyHQ,       setCompanyHQ]       = useState('');
  const [companyBranches, setCompanyBranches] = useState('');
  const [firstMessage,    setFirstMessage]    = useState('');
  const [wrapUp,          setWrapUp]          = useState('');
  const [rules,           setRules]           = useState([]);

  // ── Model config ─────────────────────────────────────────────
  const [selectedModel,   setSelectedModel]   = useState('gpt-4o-mini');
  const [temp,            setTemp]            = useState(0.7);
  const [maxTokens,       setMaxTokens]       = useState(512);
  const [systemPrompt,    setSystemPrompt]    = useState('');
  const [isManuallyEdited, setIsManuallyEdited] = useState(false);

  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(true);

  // ── Load config on mount — DB is the single source of truth ──
  useEffect(() => {
    const load = async () => {
      try {
        const cfgRes = await aiTrainingAPI.config.get();
        const cfg = cfgRes.data || {};
        setAgentName(cfg.agent_name       || '');
        setAgentLanguage(cfg.agent_language || '');
        setAgentCompany(cfg.agent_company  || '');
        setCompanyDesc(cfg.company_desc    || '');
        setCompanyHQ(cfg.company_hq        || '');
        setCompanyBranches(cfg.company_branches || '');
        setFirstMessage(cfg.first_message  || '');
        setWrapUp(cfg.wrap_up              || '');
        setRules(cfg.rules?.length ? cfg.rules : []);
        if (cfg.system_prompt) {
          setSystemPrompt(cfg.system_prompt);
          setIsManuallyEdited(true);
        }
        if (cfg.model)                     setSelectedModel(cfg.model);
        if (cfg.temperature !== undefined) setTemp(cfg.temperature);
        if (cfg.max_tokens  !== undefined) setMaxTokens(cfg.max_tokens);
      } catch {
        toast.error('Failed to load AI configuration.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // ── Auto-sync prompt whenever builder fields change (not manually edited) ──
  useEffect(() => {
    if (!isManuallyEdited) {
      setSystemPrompt(buildSystemPrompt({
        agentName, agentLanguage, agentCompany, companyDesc,
        companyHQ, companyBranches, firstMessage, wrapUp, rules,
      }));
    }
  }, [agentName, agentLanguage, agentCompany, companyDesc, companyHQ, companyBranches, firstMessage, wrapUp, rules, isManuallyEdited]);

  // ── Ref to always have fresh isManuallyEdited value in effects ──
  const isManuallyEditedRef = useRef(isManuallyEdited);
  useEffect(() => { isManuallyEditedRef.current = isManuallyEdited; }, [isManuallyEdited]);

  // ── Rules ALWAYS live-update the prompt, regardless of edit mode ──
  // When in manual-edit mode: surgically inject the new rules into the existing prompt
  // When in auto-sync mode:   the main useEffect above already handles it
  const prevRulesRef = useRef(null);
  useEffect(() => {
    // Skip the very first render (rules just loaded from DB, prompt already correct)
    if (prevRulesRef.current === null) {
      prevRulesRef.current = rules;
      return;
    }
    if (JSON.stringify(prevRulesRef.current) === JSON.stringify(rules)) return;
    prevRulesRef.current = rules;

    if (isManuallyEditedRef.current) {
      // Inject rules into the existing prompt without overwriting other manual edits
      setSystemPrompt(prev => prev ? injectRulesIntoPrompt(prev, rules) : prev);
    }
    // When NOT in manual mode: the main auto-sync useEffect handles it
  }, [rules]); // intentionally only depend on rules

  // ── Identity ALWAYS live-updates the prompt ──
  const prevIdentityRef = useRef(null);
  useEffect(() => {
    const key = JSON.stringify({ agentName, agentCompany, agentLanguage });
    if (prevIdentityRef.current === null) {
      prevIdentityRef.current = key;
      return;
    }
    if (prevIdentityRef.current === key) return;
    prevIdentityRef.current = key;

    if (isManuallyEditedRef.current) {
      setSystemPrompt(prev => prev ? injectIdentityIntoPrompt(prev, { agentName, agentCompany, agentLanguage }) : prev);
    }
  }, [agentName, agentCompany, agentLanguage]);

  // ── Opening Line ALWAYS live-updates the prompt ──
  const prevFirstMessageRef = useRef(null);
  useEffect(() => {
    if (prevFirstMessageRef.current === null) {
      prevFirstMessageRef.current = firstMessage;
      return;
    }
    if (prevFirstMessageRef.current === firstMessage) return;
    prevFirstMessageRef.current = firstMessage;

    if (isManuallyEditedRef.current) {
      setSystemPrompt(prev => prev ? injectOpeningLineIntoPrompt(prev, firstMessage) : prev);
    }
  }, [firstMessage]);

  // ── Company Intro ALWAYS live-updates the prompt ──
  const prevCompanyRef = useRef(null);
  useEffect(() => {
    const key = JSON.stringify({ agentCompany, companyDesc, companyHQ, companyBranches });
    if (prevCompanyRef.current === null) {
      prevCompanyRef.current = key;
      return;
    }
    if (prevCompanyRef.current === key) return;
    prevCompanyRef.current = key;

    if (isManuallyEditedRef.current) {
      setSystemPrompt(prev => prev ? injectCompanyIntroIntoPrompt(prev, { agentCompany, companyDesc, companyHQ, companyBranches }) : prev);
    }
  }, [agentCompany, companyDesc, companyHQ, companyBranches]);

  // ── Wrap-Up ALWAYS live-updates the prompt ──
  const prevWrapUpRef = useRef(null);
  useEffect(() => {
    if (prevWrapUpRef.current === null) {
      prevWrapUpRef.current = wrapUp;
      return;
    }
    if (prevWrapUpRef.current === wrapUp) return;
    prevWrapUpRef.current = wrapUp;

    if (isManuallyEditedRef.current) {
      setSystemPrompt(prev => prev ? injectWrapUpIntoPrompt(prev, wrapUp) : prev);
    }
  }, [wrapUp]);


  // ── Save config to DB ─────────────────────────────────────────
  const handleSave = async () => {
    if (!systemPrompt.trim()) { toast.error('System prompt is empty.'); return; }
    setSaving(true);
    try {
      await aiTrainingAPI.config.save({
        system_prompt:    systemPrompt,
        model:            selectedModel,
        temperature:      temp,
        max_tokens:       maxTokens,
        agent_name:       agentName,
        agent_language:   agentLanguage,
        agent_company:    agentCompany,
        company_desc:     companyDesc,
        company_hq:       companyHQ,
        company_branches: companyBranches,
        first_message:    firstMessage,
        wrap_up:          wrapUp,
        rules,
      });
      toast.success('AI configuration saved!');
    } catch {
      toast.error('Failed to save config.');
    } finally {
      setSaving(false);
    }
  };

  const handleResync = () => {
    setIsManuallyEdited(false);
    setSystemPrompt(buildSystemPrompt({
      agentName, agentLanguage, agentCompany, companyDesc,
      companyHQ, companyBranches, firstMessage, wrapUp, rules,
    }));
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--text-4)', fontSize: 13 }}>
      Loading AI configuration...
    </div>
  );

  return (
    <div className="flex-col gap-6">
      <div className="page-header">
        <div>
          <h2 className="page-title">AI Training Center</h2>
          <p className="page-subtitle">Configure your AI agent's identity, call flow, and rules. All changes are saved to the database.</p>
        </div>
        <button
          className="btn btn-primary"
          style={{ gap: 6, display: 'flex', alignItems: 'center' }}
          onClick={handleSave}
          disabled={saving || !systemPrompt.trim()}
        >
          <Save size={13} /> {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>

      {/* ── Builder + Prompt Preview ─────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

        {/* LEFT: Call Flow Builder */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 4 }}>
            <Brain size={15} style={{ color: '#7c3aed' }} />
            <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>Call Flow Builder</h3>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-4)' }}>
              Variable: <span style={{ fontSize: 10, fontWeight: 600, background: 'rgba(124,58,237,0.1)', color: '#7c3aed', padding: '2px 6px', borderRadius: 4 }}>{'{{name}}'}</span>
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, maxHeight: 760, overflowY: 'auto', paddingRight: 2 }}>

            {/* [Identity] */}
            <Section icon={Bot} color="#7c3aed" title="[Identity] — Agent & Company">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field label="Agent Name">
                  <input className="input" style={{ width: '100%', fontSize: 12 }} value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="e.g. reva" />
                </Field>
                <Field label="Company Name">
                  <input className="input" style={{ width: '100%', fontSize: 12 }} value={agentCompany} onChange={e => setAgentCompany(e.target.value)} placeholder="e.g. WalkinSoftware" />
                </Field>
              </div>
              <Field label="Language">
                <input className="input" style={{ width: '100%', fontSize: 12 }} value={agentLanguage} onChange={e => setAgentLanguage(e.target.value)} placeholder="e.g. Indian Languages" />
              </Field>
            </Section>

            {/* Call Flow — First Message */}
            <Section icon={MessageSquare} color="#2563eb" title="[Call Flow] — Opening Line">
              <Field label="First message sent to candidate" hint="Use {{name}} for candidate's name">
                <textarea className="input" rows={3} style={{ width: '100%', fontSize: 12, resize: 'vertical' }} value={firstMessage} onChange={e => setFirstMessage(e.target.value)} placeholder="Hi {{name}}, this is reva calling from WalkinSoftware..." />
              </Field>
            </Section>

            {/* Company Introduction */}
            <Section icon={Brain} color="#0891b2" title="Company Introduction">
              <Field label="Company Description" hint="Used in Step 2 of the call flow">
                <textarea className="input" rows={2} style={{ width: '100%', fontSize: 12, resize: 'vertical' }} value={companyDesc} onChange={e => setCompanyDesc(e.target.value)} placeholder="We are a technology education and software training provider." />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field label="Head Office Location">
                  <input className="input" style={{ width: '100%', fontSize: 12 }} value={companyHQ} onChange={e => setCompanyHQ(e.target.value)} placeholder="e.g. JP Nagar" />
                </Field>
                <Field label="Branches">
                  <input className="input" style={{ width: '100%', fontSize: 12 }} value={companyBranches} onChange={e => setCompanyBranches(e.target.value)} placeholder="e.g. US and Singapore" />
                </Field>
              </div>
            </Section>

            {/* Wrap-Up */}
            <Section icon={MessageSquare} color="#7c3aed" title="Wrap-Up Message">
              <Field label="Closing message" hint="Use {{name}} for candidate's name">
                <textarea className="input" rows={3} style={{ width: '100%', fontSize: 12, resize: 'vertical' }} value={wrapUp} onChange={e => setWrapUp(e.target.value)} placeholder="Thanks for your time, {{name}}! We will get back to you soon. Have a great day!" />
              </Field>
            </Section>

            {/* Rules — changes always reflect in prompt immediately */}
            <Section icon={Settings} color="#ef4444" title="Rules">
              <div style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 4 }}>
                These rules appear live in the prompt on the right. Add, edit, or remove rules and the prompt updates instantly.
              </div>
              <DynamicList items={rules} onChange={setRules} placeholder="Rule" addLabel="Add Rule" />
            </Section>

          </div>
        </div>

        {/* RIGHT: Prompt Preview + Model Config */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Generated System Prompt */}
          <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
              <Sparkles size={15} style={{ color: '#f97316' }} />
              <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, flex: 1 }}>Generated System Prompt</h3>

              {isManuallyEdited ? (
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: 10, padding: '2px 8px', gap: 4, display: 'flex', alignItems: 'center' }}
                  onClick={handleResync}
                  title="Re-generate system prompt from builder fields"
                >
                  <RotateCcw size={11} /> Resync from Builder
                </button>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 600, background: 'rgba(37,99,235,0.1)', color: '#2563eb', padding: '2px 8px', borderRadius: 4 }}>
                  Auto-synced
                </span>
              )}
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-4)', lineHeight: 1.5 }}>
              ✅ Rules from the left panel are always live in the prompt below. Edit any field on the left — the prompt updates instantly.
            </div>

            <textarea
              className="input"
              style={{
                width: '100%',
                fontSize: 11.5,
                fontFamily: 'monospace',
                minHeight: 420,
                resize: 'vertical',
                lineHeight: 1.65
              }}
              value={systemPrompt}
              onChange={e => {
                setSystemPrompt(e.target.value);
                setIsManuallyEdited(true);
              }}
              placeholder="System prompt will appear here once you fill in the fields on the left..."
            />

            <button
              className="btn btn-primary"
              style={{ gap: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={handleSave}
              disabled={saving || !systemPrompt.trim()}
            >
              <Save size={13} /> {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>

          {/* Model Config */}
          <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
              <Settings size={15} style={{ color: '#f97316' }} />
              <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>Model Settings</h3>
            </div>
            <Field label="Model">
              <select className="input" style={{ width: '100%', fontSize: 12 }} value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>
                <option value="gpt-4o-mini">gpt-4o-mini (fast)</option>
                <option value="gpt-4o">gpt-4o (smart)</option>
                <option value="gpt-3.5-turbo">gpt-3.5-turbo (legacy)</option>
              </select>
            </Field>
            <Field label={`Temperature: ${temp}`}>
              <input type="range" min="0" max="1" step="0.05" value={temp} onChange={e => setTemp(parseFloat(e.target.value))} style={{ width: '100%' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-4)' }}><span>Precise (0)</span><span>Creative (1)</span></div>
            </Field>
            <Field label={`Max Tokens: ${maxTokens}`}>
              <input type="range" min="128" max="2048" step="64" value={maxTokens} onChange={e => setMaxTokens(parseInt(e.target.value))} style={{ width: '100%' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-4)' }}><span>128</span><span>2048</span></div>
            </Field>
          </div>
        </div>
      </div>
    </div>
  );
}
