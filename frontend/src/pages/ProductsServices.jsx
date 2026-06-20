import { useState, useEffect } from 'react';
import {
  Package, BookOpen, Plus, Trash2, Edit2, Save, X,
  Tag, Clock, DollarSign, Users, Award, Briefcase,
  CheckCircle, Layers, RefreshCw, RotateCcw, Brain,
  ChevronDown, ChevronRight, Zap, MessageSquare, Info,
  Star, Shield, TrendingUp
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { aiTrainingAPI } from '../lib/api';

// ── Auto-generate code: 4 letters + 4 digits ─────────────────
const genCode = (name) => {
  const letters = name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${letters}${digits}`;
};

// ── Category badge ────────────────────────────────────────────
const CAT_COLORS = {
  Training:   { bg: 'rgba(37,99,235,0.12)',  color: '#2563eb', icon: '🎓' },
  Corporate:  { bg: 'rgba(124,58,237,0.12)', color: '#7c3aed', icon: '🏢' },
  Software:   { bg: 'rgba(249,115,22,0.12)', color: '#f97316', icon: '💻' },
  Service:    { bg: 'rgba(16,185,129,0.12)', color: '#10b981', icon: '⚙️' },
  Consulting: { bg: 'rgba(8,145,178,0.12)',  color: '#0891b2', icon: '💡' },
};
const CatBadge = ({ cat }) => {
  const c = CAT_COLORS[cat] || { bg: 'rgba(100,116,139,0.1)', color: '#64748b', icon: '📦' };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
      background: c.bg, color: c.color, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {c.icon} {cat}
    </span>
  );
};

// ── Type badge for services ───────────────────────────────────
const TYPE_COLORS = {
  'Classroom':        { bg: 'rgba(37,99,235,0.1)',  color: '#2563eb' },
  'Online Live':      { bg: 'rgba(16,185,129,0.1)', color: '#059669' },
  'Hybrid':           { bg: 'rgba(124,58,237,0.1)', color: '#7c3aed' },
  'Placement':        { bg: 'rgba(249,115,22,0.1)', color: '#ea580c' },
  'Certification':    { bg: 'rgba(234,179,8,0.12)', color: '#a16207' },
  'Service':          { bg: 'rgba(100,116,139,0.1)',color: '#475569' },
};
const TypeBadge = ({ type }) => {
  const c = TYPE_COLORS[type] || { bg: 'rgba(100,116,139,0.1)', color: '#64748b' };
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: c.bg, color: c.color }}>
      {type}
    </span>
  );
};

// ── Detail row ────────────────────────────────────────────────
const Row = ({ icon: Icon, label, children }) => (
  <div style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
    <Icon size={13} style={{ color: 'var(--text-4)', flexShrink: 0, marginTop: 3 }} />
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.6 }}>{children}</div>
    </div>
  </div>
);

// ── Tag list ──────────────────────────────────────────────────
const TagList = ({ items }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
    {(items || []).map((t, i) => (
      <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 5,
        background: 'var(--bg-2)', color: 'var(--text-3)', fontWeight: 500, border: '1px solid var(--border)' }}>
        {t}
      </span>
    ))}
  </div>
);

// ── AI Context Preview panel ──────────────────────────────────
const AIContextPanel = ({ product, services }) => {
  const [open, setOpen] = useState(false);
  if (!product) return null;
  const productServices = services.filter(s => s.product === product.name);
  const preview = buildAIContext(product, productServices);
  return (
    <div style={{ marginTop: 14, border: '1px solid rgba(37,99,235,0.25)', borderRadius: 10, overflow: 'hidden', background: 'linear-gradient(135deg, rgba(37,99,235,0.03), rgba(124,58,237,0.03))' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '11px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Brain size={14} style={{ color: '#2563eb' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb' }}>AI Context Preview</span>
          <span style={{ fontSize: 10, color: 'var(--text-4)', background: 'rgba(37,99,235,0.08)', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>
            What the AI reads during calls
          </span>
        </div>
        {open ? <ChevronDown size={13} style={{ color: 'var(--text-4)' }} /> : <ChevronRight size={13} style={{ color: 'var(--text-4)' }} />}
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace', background: 'var(--bg-hover)',
            borderRadius: 8, padding: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto',
            border: '1px solid var(--border)' }}>
            {preview}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
            <Zap size={11} style={{ color: '#f59e0b' }} />
            <span style={{ fontSize: 10, color: 'var(--text-4)' }}>
              This text is injected into the AI agent's system prompt during calls — the richer the description, the better the AI answers lead queries.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Build AI context string ───────────────────────────────────
const buildAIContext = (product, services) => {
  const lines = [];
  lines.push(`=== PRODUCT: ${product.name} ===`);
  lines.push(`Category: ${product.category} | Code: ${product.code}`);
  lines.push(`Duration: ${product.duration || '—'}`);
  lines.push(`Fee Range: ${product.fee_range || '—'}${product.emi_available ? ' (EMI available)' : ''}`);
  lines.push(`Placement Support: ${product.placement_support ? 'Yes — 100% placement assistance' : 'Not included'}`);
  lines.push(`Batch Modes: ${(product.batch_types || []).join(', ') || '—'}`);
  lines.push('');
  lines.push('Description:');
  lines.push(product.description || '—');
  lines.push('');
  if ((product.key_features || []).length) {
    lines.push('Key Features / Topics:');
    (product.key_features || []).forEach(f => lines.push(`  • ${f}`));
    lines.push('');
  }
  lines.push(`Target Audience: ${product.target_audience || '—'}`);
  lines.push(`Prerequisites: ${product.prerequisites || 'None'}`);
  lines.push(`Certification: ${product.certification || '—'}`);
  lines.push(`Career Opportunities: ${product.career_opportunities || '—'}`);
  if ((product.questions || []).length) {
    lines.push('');
    lines.push('Screening / Qualification Questions:');
    (product.questions || []).forEach((q, idx) => lines.push(`  ${idx + 1}. ${q}`));
  }
  if (services.length) {
    lines.push('');
    lines.push('--- Services / Batches Available ---');
    services.forEach(s => {
      lines.push(`  [${s.code}] ${s.name} (${s.type || 'Service'})`);
      if (s.description) lines.push(`    ${s.description}`);
      if (s.duration) lines.push(`    Duration: ${s.duration}`);
      if (s.fee) lines.push(`    Fee: ${s.fee}`);
    });
  }
  return lines.join('\n');
};

// ── Empty product form template ───────────────────────────────
const emptyProduct = () => ({
  code: '', name: '', category: 'Training', description: '', key_features: [''],
  duration: '', fee_range: '', emi_available: false, target_audience: '',
  prerequisites: '', certification: '', career_opportunities: '', placement_support: false, batch_types: [],
  questions: [''],
});

const emptyService = (productName = '') => ({
  code: '', name: '', product: productName, type: 'Online Live', description: '', duration: '', fee: '',
});

// ═══════════════════════════════════════════════════════════════
export default function ProductsServices() {
  const [products,  setProducts]  = useState([]);
  const [services,  setServices]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [resetting, setResetting] = useState(false);

  const [activeProduct, setActiveProduct] = useState(null);
  const [activeTab,     setActiveTab]     = useState('details');
  const [editingProduct, setEditingProduct] = useState(null);
  const [editingService, setEditingService] = useState(null);
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [showNewService, setShowNewService] = useState(false);
  const [newProduct, setNewProduct] = useState(emptyProduct());
  const [newService, setNewService] = useState(emptyService());

  const [generatingQuestions, setGeneratingQuestions] = useState(false);

  const handleGenerateQuestions = async (form, setForm) => {
    if (!form.name.trim()) {
      toast.error('Product name is required to generate questions.');
      return;
    }
    setGeneratingQuestions(true);
    try {
      const res = await aiTrainingAPI.generateQuestions({ name: form.name, description: form.description });
      const generated = res.data?.questions || [];
      if (generated.length > 0) {
        setForm(p => ({ ...p, questions: generated }));
        toast.success('Successfully generated 4 questions with AI!');
      } else {
        toast.error('AI returned empty questions list.');
      }
    } catch (e) {
      toast.error('Failed to generate questions using AI.');
    } finally {
      setGeneratingQuestions(false);
    }
  };

  const handleGenerateQuestionsForNew = () => handleGenerateQuestions(newProduct, setNewProduct);
  const handleGenerateQuestionsForEdit = () => handleGenerateQuestions(editingProduct, setEditingProduct);

  const selected   = products.find(p => p.code === activeProduct) || null;
  const myServices = services.filter(s => s.product === selected?.name);

  // ── Load catalog ─────────────────────────────────────────────
  const loadCatalog = async () => {
    setLoading(true);
    try {
      const r = await aiTrainingAPI.catalog.get();
      const data = r.data || {};
      setProducts(data.products || []);
      setServices(data.services || []);
      if (data.products?.length) setActiveProduct(data.products[0].code);
    } catch { toast.error('Failed to load catalog.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadCatalog(); }, []);

  // ── Save catalog ─────────────────────────────────────────────
  const saveCatalog = async (updatedProducts, updatedServices) => {
    setSaving(true);
    try {
      await aiTrainingAPI.catalog.save({ products: updatedProducts, services: updatedServices });
      toast.success('Catalog saved!');
    } catch { toast.error('Failed to save.'); }
    finally { setSaving(false); }
  };

  // ── Reset to document defaults ────────────────────────────────
  const handleReset = async () => {
    if (!window.confirm('Reset catalog to the full PRAVESHA™ document defaults?\n\nThis will restore all 7 products and 35 services with complete AI descriptions. Your custom changes will be overwritten.')) return;
    setResetting(true);
    try {
      const r = await aiTrainingAPI.catalog.reset();
      const data = r.data || {};
      setProducts(data.products || []);
      setServices(data.services || []);
      if (data.products?.length) setActiveProduct(data.products[0].code);
      setEditingProduct(null);
      toast.success('✅ Catalog reset to document defaults — 7 products & 35 services loaded!');
    } catch { toast.error('Failed to reset catalog.'); }
    finally { setResetting(false); }
  };

  // ── Add product ───────────────────────────────────────────────
  const handleAddProduct = async () => {
    if (!newProduct.name.trim()) { toast.error('Product name is required.'); return; }
    const code = genCode(newProduct.name);
    const product = { ...newProduct, code };
    const updated = [...products, product];
    setProducts(updated);
    setActiveProduct(code);
    setShowNewProduct(false);
    setNewProduct(emptyProduct());
    await saveCatalog(updated, services);
  };

  // ── Update product ────────────────────────────────────────────
  const handleSaveProduct = async () => {
    if (!editingProduct) return;
    const updated = products.map(p => p.code === editingProduct.code ? editingProduct : p);
    setProducts(updated);
    setEditingProduct(null);
    await saveCatalog(updated, services);
  };

  // ── Delete product ────────────────────────────────────────────
  const handleDeleteProduct = async (code) => {
    if (!window.confirm('Delete this product and all its services?')) return;
    const prod = products.find(p => p.code === code);
    const updatedP = products.filter(p => p.code !== code);
    const updatedS = services.filter(s => s.product !== prod?.name);
    setProducts(updatedP);
    setServices(updatedS);
    if (activeProduct === code) setActiveProduct(updatedP[0]?.code || null);
    await saveCatalog(updatedP, updatedS);
  };

  // ── Add service ───────────────────────────────────────────────
  const handleAddService = async () => {
    if (!newService.name.trim()) { toast.error('Service name is required.'); return; }
    const code = genCode(newService.name);
    const service = { ...newService, code, product: selected?.name || '' };
    const updated = [...services, service];
    setServices(updated);
    setShowNewService(false);
    setNewService(emptyService(selected?.name));
    await saveCatalog(products, updated);
  };

  // ── Update service ────────────────────────────────────────────
  const handleSaveService = async () => {
    if (!editingService) return;
    const updated = services.map(s => s.code === editingService.code ? editingService : s);
    setServices(updated);
    setEditingService(null);
    await saveCatalog(products, updated);
  };

  // ── Delete service ────────────────────────────────────────────
  const handleDeleteService = async (code) => {
    if (!window.confirm('Delete this service?')) return;
    const updated = services.filter(s => s.code !== code);
    setServices(updated);
    await saveCatalog(products, updated);
  };

  // ── Helpers ───────────────────────────────────────────────────
  const updFeature = (arr, i, val) => arr.map((f, idx) => idx === i ? val : f);
  const addFeature = (arr) => [...arr, ''];
  const delFeature = (arr, i) => arr.filter((_, idx) => idx !== i);
  const updQuestion = (arr, i, val) => (arr || []).map((q, idx) => idx === i ? val : q);
  const addQuestion = (arr) => [...(arr || []), ''];
  const delQuestion = (arr, i) => (arr || []).filter((_, idx) => idx !== i);
  const toggleBatch = (form, setForm, type) => {
    const cur = form.batch_types || [];
    setForm({ ...form, batch_types: cur.includes(type) ? cur.filter(t => t !== type) : [...cur, type] });
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--text-4)', fontSize: 13, gap: 10 }}>
      <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading catalog...
    </div>
  );

  return (
    <div className="flex-col gap-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Products &amp; Services</h2>
          <p className="page-subtitle">
            Complete product catalog with AI-optimized descriptions — the AI agent reads this during calls to answer lead queries accurately.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{ gap: 5, display: 'flex', alignItems: 'center', color: '#7c3aed', borderColor: 'rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.06)' }}
            onClick={handleReset}
            disabled={resetting || saving}
            title="Reset to document defaults — loads all 7 products & 35 services from the Data Format document">
            <RotateCcw size={12} style={{ animation: resetting ? 'spin 1s linear infinite' : 'none' }} />
            {resetting ? 'Resetting...' : 'Reset to Defaults'}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            style={{ gap: 4, display: 'flex', alignItems: 'center' }}
            onClick={loadCatalog}>
            <RefreshCw size={13} /> Refresh
          </button>
          <button
            className="btn btn-primary btn-sm"
            style={{ gap: 4, display: 'flex', alignItems: 'center' }}
            onClick={() => { setShowNewProduct(true); setNewProduct(emptyProduct()); }}>
            <Plus size={13} /> Add Product
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Products', value: products.length, icon: Package, color: '#2563eb' },
          { label: 'Total Services', value: services.length, icon: BookOpen, color: '#7c3aed' },
          { label: 'Training Programs', value: products.filter(p => p.category === 'Training').length, icon: Award, color: '#059669' },
          { label: 'Software Products', value: products.filter(p => p.category === 'Software').length, icon: Zap, color: '#f97316' },
          { label: 'With Placement', value: products.filter(p => p.placement_support).length, icon: TrendingUp, color: '#0891b2' },
        ].map(stat => (
          <div key={stat.label} className="card" style={{ flex: 1, minWidth: 120, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: `${stat.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <stat.icon size={15} style={{ color: stat.color }} />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1 }}>{stat.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 600, marginTop: 2 }}>{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Main layout: product list + detail */}
      <div style={{ display: 'grid', gridTemplateColumns: '290px 1fr', gap: 16, alignItems: 'start' }}>

        {/* LEFT: Product list */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700,
            color: 'var(--text-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'var(--bg-2)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Package size={13} style={{ color: '#2563eb' }} /> Products ({products.length})
            </span>
          </div>
          <div style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
            {products.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-4)', fontSize: 12 }}>
                No products yet.<br />Click "Reset to Defaults" to load the full catalog.
              </div>
            )}
            {products.map(p => {
              const svcCount = services.filter(s => s.product === p.name).length;
              return (
                <div
                  key={p.code}
                  onClick={() => { setActiveProduct(p.code); setEditingProduct(null); setActiveTab('details'); }}
                  style={{
                    padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                    background: activeProduct === p.code ? 'rgba(37,99,235,0.05)' : 'transparent',
                    borderLeft: activeProduct === p.code ? '3px solid #2563eb' : '3px solid transparent',
                    transition: 'all 0.15s',
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'monospace', background: 'var(--bg-hover)', padding: '1px 5px', borderRadius: 3 }}>{p.code}</span>
                        <CatBadge cat={p.category} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                        {p.fee_range && <div style={{ fontSize: 10, color: '#16a34a', fontWeight: 700 }}>{p.fee_range}</div>}
                        <div style={{ fontSize: 9, color: 'var(--text-4)', background: 'var(--bg-hover)', padding: '1px 6px', borderRadius: 8, fontWeight: 600 }}>
                          {svcCount} services
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteProduct(p.code); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', padding: 2, flexShrink: 0, opacity: 0.4 }}
                      title="Delete product">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: Product detail */}
        {selected ? (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* Product header */}
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex',
              justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(37,99,235,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                  {CAT_COLORS[selected.category]?.icon || '📦'}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-1)' }}>{selected.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-4)', fontFamily: 'monospace', background: 'var(--bg-hover)', padding: '1px 6px', borderRadius: 4 }}>{selected.code}</span>
                    <CatBadge cat={selected.category} />
                    {selected.placement_support && <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 700, background: 'rgba(22,163,74,0.1)', padding: '1px 7px', borderRadius: 10 }}>✓ Placement</span>}
                    {selected.emi_available && <span style={{ fontSize: 10, color: '#2563eb', fontWeight: 700, background: 'rgba(37,99,235,0.1)', padding: '1px 7px', borderRadius: 10 }}>EMI</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {editingProduct ? (
                  <>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingProduct(null)}>Cancel</button>
                    <button className="btn btn-primary btn-sm" style={{ gap: 4, display: 'flex', alignItems: 'center' }} onClick={handleSaveProduct} disabled={saving}>
                      <Save size={12} /> {saving ? 'Saving...' : 'Save'}
                    </button>
                  </>
                ) : (
                  <button className="btn btn-secondary btn-sm" style={{ gap: 4, display: 'flex', alignItems: 'center' }}
                    onClick={() => setEditingProduct({ ...selected, key_features: [...(selected.key_features || [])], batch_types: [...(selected.batch_types || [])] })}>
                    <Edit2 size={12} /> Edit
                  </button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 18px', background: 'var(--bg-2)' }}>
              {['details', 'services', 'ai-context'].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '10px 14px', fontSize: 12,
                  fontWeight: 600, color: activeTab === tab ? '#2563eb' : 'var(--text-4)',
                  borderBottom: activeTab === tab ? '2px solid #2563eb' : '2px solid transparent',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  {tab === 'details' && <><Tag size={11} /> Product Details</>}
                  {tab === 'services' && <><BookOpen size={11} /> Services ({myServices.length})</>}
                  {tab === 'ai-context' && <><Brain size={11} style={{ color: activeTab === 'ai-context' ? '#2563eb' : 'var(--text-4)' }} /> AI Context</>}
                </button>
              ))}
            </div>

            <div style={{ padding: 18, maxHeight: 'calc(100vh - 360px)', overflowY: 'auto' }}>

              {/* ── DETAILS TAB ── */}
              {activeTab === 'details' && (
                editingProduct ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.15)', borderRadius: 8, padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <Info size={13} style={{ color: '#2563eb', flexShrink: 0, marginTop: 1 }} />
                      <span style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                        <strong>Tip:</strong> The Description field is most important — write it as if you're briefing a counselor. Include selling points, fee, batch types, and what questions the AI should ask. The AI will use this to answer lead queries during calls.
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div className="input-group">
                        <label className="input-label">Product Name *</label>
                        <input className="input" value={editingProduct.name} onChange={e => setEditingProduct(p => ({ ...p, name: e.target.value }))} />
                      </div>
                      <div className="input-group">
                        <label className="input-label">Category</label>
                        <select className="input" value={editingProduct.category} onChange={e => setEditingProduct(p => ({ ...p, category: e.target.value }))}>
                          {['Training', 'Corporate', 'Software', 'Service', 'Consulting'].map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="input-group">
                      <label className="input-label">
                        Description — AI reads this during calls to answer lead queries ⭐
                      </label>
                      <textarea className="input" rows={6} style={{ resize: 'vertical', fontFamily: 'inherit' }}
                        placeholder="Write a detailed description. Include: what the course covers, who it's for, fee, duration, batch modes, placement, certification, salary range, key selling points. The richer this is, the better the AI answers lead questions."
                        value={editingProduct.description}
                        onChange={e => setEditingProduct(p => ({ ...p, description: e.target.value }))} />
                    </div>

                    <div className="input-group">
                      <label className="input-label">Key Features / Topics Covered</label>
                      {editingProduct.key_features.map((f, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          <input className="input" style={{ flex: 1, fontSize: 12 }} value={f} placeholder={`Feature ${i + 1}`}
                            onChange={e => setEditingProduct(p => ({ ...p, key_features: updFeature(p.key_features, i, e.target.value) }))} />
                          <button onClick={() => setEditingProduct(p => ({ ...p, key_features: delFeature(p.key_features, i) }))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4 }}>
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                      <button className="btn btn-secondary btn-sm" style={{ fontSize: 11, gap: 4, display: 'flex', alignItems: 'center' }}
                        onClick={() => setEditingProduct(p => ({ ...p, key_features: addFeature(p.key_features) }))}>
                        <Plus size={11} /> Add Feature
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div className="input-group">
                        <label className="input-label">Duration</label>
                        <input className="input" placeholder="e.g. 6 Months" value={editingProduct.duration}
                          onChange={e => setEditingProduct(p => ({ ...p, duration: e.target.value }))} />
                      </div>
                      <div className="input-group">
                        <label className="input-label">Fee Range</label>
                        <input className="input" placeholder="e.g. ₹40,000 – ₹60,000" value={editingProduct.fee_range}
                          onChange={e => setEditingProduct(p => ({ ...p, fee_range: e.target.value }))} />
                      </div>
                    </div>

                    <div className="input-group">
                      <label className="input-label">Target Audience</label>
                      <textarea className="input" rows={2} style={{ resize: 'vertical' }} value={editingProduct.target_audience}
                        onChange={e => setEditingProduct(p => ({ ...p, target_audience: e.target.value }))} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div className="input-group">
                        <label className="input-label">Prerequisites</label>
                        <input className="input" value={editingProduct.prerequisites}
                          onChange={e => setEditingProduct(p => ({ ...p, prerequisites: e.target.value }))} />
                      </div>
                      <div className="input-group">
                        <label className="input-label">Certification Awarded</label>
                        <input className="input" value={editingProduct.certification}
                          onChange={e => setEditingProduct(p => ({ ...p, certification: e.target.value }))} />
                      </div>
                    </div>

                    <div className="input-group">
                      <label className="input-label">Career Opportunities</label>
                      <input className="input" value={editingProduct.career_opportunities}
                        onChange={e => setEditingProduct(p => ({ ...p, career_opportunities: e.target.value }))} />
                    </div>

                    <div className="input-group">
                      <label className="input-label">Batch Types Available</label>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {['Classroom', 'Online Live', 'Hybrid', 'Weekend'].map(type => (
                          <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                            <input type="checkbox" checked={(editingProduct.batch_types || []).includes(type)}
                              onChange={() => toggleBatch(editingProduct, setEditingProduct, type)} />
                            {type}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Screening Questions Editor */}
                    <div className="input-group" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <label className="input-label" style={{ marginBottom: 0 }}>
                          Screening / Qualification Questions (ask candidate one by one during calls)
                        </label>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: 11, gap: 4, display: 'flex', alignItems: 'center', padding: '4px 8px' }}
                          onClick={handleGenerateQuestionsForEdit}
                          disabled={generatingQuestions}
                        >
                          <Brain size={12} style={{ color: '#2563eb' }} />
                          {generatingQuestions ? 'Generating...' : 'Auto-Generate with AI'}
                        </button>
                      </div>
                      {(editingProduct.questions || []).map((q, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', minWidth: 24, paddingTop: 8 }}>Q{i+1}</span>
                          <input className="input" style={{ flex: 1, fontSize: 12 }} value={q} placeholder={`Question ${i + 1}`}
                            onChange={e => setEditingProduct(p => ({ ...p, questions: updQuestion(p.questions, i, e.target.value) }))} />
                          <button onClick={() => setEditingProduct(p => ({ ...p, questions: delQuestion(p.questions, i) }))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4 }}>
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                      <button className="btn btn-secondary btn-sm" style={{ fontSize: 11, gap: 4, display: 'flex', alignItems: 'center', alignSelf: 'flex-start' }}
                        onClick={() => setEditingProduct(p => ({ ...p, questions: addQuestion(p.questions) }))}>
                        <Plus size={11} /> Add Question
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={editingProduct.emi_available}
                          onChange={e => setEditingProduct(p => ({ ...p, emi_available: e.target.checked }))} />
                        EMI / Installment Available
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={editingProduct.placement_support}
                          onChange={e => setEditingProduct(p => ({ ...p, placement_support: e.target.checked }))} />
                        Placement Support Included
                      </label>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    <Row icon={MessageSquare} label="Description — AI reads this during calls">
                      <span style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{selected.description || '—'}</span>
                    </Row>
                    <Row icon={CheckCircle} label="Key Features / Topics">
                      {(selected.key_features || []).length ? (
                        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 2 }}>
                          {selected.key_features.map((f, i) => <li key={i}>{f}</li>)}
                        </ul>
                      ) : '—'}
                    </Row>
                    <Row icon={Clock} label="Duration">{selected.duration || '—'}</Row>
                    <Row icon={DollarSign} label="Fee Range">
                      <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 13 }}>{selected.fee_range || '—'}</span>
                      {selected.emi_available && <span style={{ marginLeft: 8, fontSize: 10, color: '#2563eb', fontWeight: 700, background: 'rgba(37,99,235,0.08)', padding: '2px 8px', borderRadius: 10 }}>EMI Available</span>}
                    </Row>
                    <Row icon={Users} label="Target Audience">{selected.target_audience || '—'}</Row>
                    <Row icon={Briefcase} label="Prerequisites">{selected.prerequisites || '—'}</Row>
                    <Row icon={Award} label="Certification Awarded">
                      <span style={{ color: '#a16207', fontWeight: 600 }}>{selected.certification || '—'}</span>
                    </Row>
                    <Row icon={Star} label="Career Opportunities">{selected.career_opportunities || '—'}</Row>
                    <Row icon={Layers} label="Batch Types">
                      <TagList items={selected.batch_types} />
                    </Row>
                    <Row icon={Brain} label="Screening Questions (Dynamic)">
                      {(selected.questions || []).length ? (
                        <ol style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.8 }}>
                          {selected.questions.map((q, i) => <li key={i}>{q}</li>)}
                        </ol>
                      ) : '—'}
                    </Row>
                    {selected.placement_support !== undefined && (
                      <Row icon={Shield} label="Placement Support">
                        <span style={{ color: selected.placement_support ? '#16a34a' : '#ef4444', fontWeight: 700 }}>
                          {selected.placement_support ? '✓ Yes — 100% placement assistance included' : '✗ Not included'}
                        </span>
                      </Row>
                    )}

                    {/* AI Context Preview (collapsible) */}
                    <AIContextPanel product={selected} services={services} />
                  </div>
                )
              )}

              {/* ── SERVICES TAB ── */}
              {activeTab === 'services' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-4)' }}>
                      Services linked to <strong>{selected.name}</strong> — {myServices.length} found
                    </div>
                    <button className="btn btn-primary btn-sm" style={{ gap: 4, display: 'flex', alignItems: 'center' }}
                      onClick={() => { setShowNewService(true); setNewService(emptyService(selected.name)); }}>
                      <Plus size={12} /> Add Service
                    </button>
                  </div>

                  {myServices.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text-4)', fontSize: 12, border: '2px dashed var(--border)', borderRadius: 8 }}>
                      <BookOpen size={22} style={{ display: 'block', margin: '0 auto 8px', opacity: 0.3 }} />
                      No services yet. Click "Add Service" or "Reset to Defaults" to load all services.
                    </div>
                  )}

                  {myServices.map(svc => (
                    <div key={svc.code} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                      {editingService?.code === svc.code ? (
                        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div className="input-group">
                              <label className="input-label">Service Name *</label>
                              <input className="input" value={editingService.name}
                                onChange={e => setEditingService(s => ({ ...s, name: e.target.value }))} />
                            </div>
                            <div className="input-group">
                              <label className="input-label">Service Type</label>
                              <select className="input" value={editingService.type}
                                onChange={e => setEditingService(s => ({ ...s, type: e.target.value }))}>
                                {['Classroom', 'Online Live', 'Hybrid', 'Placement', 'Certification', 'Career Counseling', 'Demo Session', 'Alumni', 'Service'].map(t => <option key={t}>{t}</option>)}
                              </select>
                            </div>
                          </div>
                          <div className="input-group">
                            <label className="input-label">Description (AI uses this to explain this service to leads)</label>
                            <textarea className="input" rows={3} style={{ resize: 'vertical' }}
                              placeholder="Describe what this service includes, schedule, delivery mode, inclusions..."
                              value={editingService.description}
                              onChange={e => setEditingService(s => ({ ...s, description: e.target.value }))} />
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div className="input-group">
                              <label className="input-label">Duration</label>
                              <input className="input" placeholder="e.g. 6 Months" value={editingService.duration}
                                onChange={e => setEditingService(s => ({ ...s, duration: e.target.value }))} />
                            </div>
                            <div className="input-group">
                              <label className="input-label">Fee</label>
                              <input className="input" placeholder="e.g. ₹45,000 or Included" value={editingService.fee}
                                onChange={e => setEditingService(s => ({ ...s, fee: e.target.value }))} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => setEditingService(null)}>Cancel</button>
                            <button className="btn btn-primary btn-sm" onClick={handleSaveService} disabled={saving}>Save</button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ padding: '10px 14px', background: 'var(--bg-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>{svc.name}</span>
                                <TypeBadge type={svc.type || 'Service'} />
                              </div>
                              <span style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'monospace', background: 'var(--bg-hover)', padding: '1px 5px', borderRadius: 3, marginTop: 3, display: 'inline-block' }}>{svc.code}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => setEditingService({ ...svc })}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', padding: 4 }}>
                                <Edit2 size={12} />
                              </button>
                              <button onClick={() => handleDeleteService(svc.code)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4 }}>
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                          <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {svc.description && (
                              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>{svc.description}</div>
                            )}
                            <div style={{ display: 'flex', gap: 16, marginTop: 4, flexWrap: 'wrap' }}>
                              {svc.duration && <span style={{ fontSize: 11, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={10} /> {svc.duration}</span>}
                              {svc.fee && <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}><DollarSign size={10} /> {svc.fee}</span>}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── AI CONTEXT TAB ── */}
              {activeTab === 'ai-context' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Info banner */}
                  <div style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.08), rgba(124,58,237,0.06))', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 10, padding: '12px 14px', display: 'flex', gap: 10 }}>
                    <Brain size={18} style={{ color: '#2563eb', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', marginBottom: 4 }}>How the AI Uses This Data During Calls</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
                        When the AI agent calls a lead who expressed interest in <strong>{selected.name}</strong>, it reads the full context below — including product description, pricing, features, and all linked services.
                        The AI uses this to answer questions like "What is the fee?", "Is there placement?", "What are the batch timings?", and to recommend the right service based on the lead's preferences.
                      </div>
                    </div>
                  </div>

                  {/* Context tips */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {[
                      { icon: MessageSquare, label: 'Answering Queries', desc: 'Description → AI uses this to answer "what is this course?" questions', color: '#2563eb' },
                      { icon: DollarSign, label: 'Fee Questions', desc: 'Fee Range + Service fees → AI tells the lead exact pricing options', color: '#16a34a' },
                      { icon: Layers, label: 'Batch Selection', desc: 'Batch Types + Services → AI asks preferred mode (classroom/online)', color: '#7c3aed' },
                      { icon: TrendingUp, label: 'Lead Qualification', desc: 'Target Audience → AI confirms if the lead is a good fit', color: '#f97316' },
                    ].map(tip => (
                      <div key={tip.label} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', display: 'flex', gap: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 6, background: `${tip.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <tip.icon size={13} style={{ color: tip.color }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-1)', marginBottom: 2 }}>{tip.label}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-4)', lineHeight: 1.5 }}>{tip.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Full AI context preview */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Brain size={13} style={{ color: '#2563eb' }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>Full AI Context — {selected.name}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-4)', background: 'var(--bg-hover)', padding: '1px 8px', borderRadius: 10 }}>
                        {myServices.length} services included
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'monospace', background: 'var(--bg-hover)',
                      borderRadius: 10, padding: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: 480, overflowY: 'auto',
                      border: '1px solid var(--border)' }}>
                      {buildAIContext(selected, myServices)}
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Zap size={11} style={{ color: '#f59e0b' }} />
                      <span style={{ fontSize: 10, color: 'var(--text-4)' }}>
                        This entire block is injected into the AI's system prompt when calling a lead interested in {selected.name}. Edit the Description, Features, and Services tabs to improve AI accuracy.
                      </span>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        ) : (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, color: 'var(--text-4)', fontSize: 13, gap: 12 }}>
            <Package size={32} style={{ opacity: 0.2 }} />
            <span>Select a product from the left to view details.</span>
            {products.length === 0 && (
              <button className="btn btn-primary btn-sm" style={{ gap: 5, display: 'flex', alignItems: 'center', marginTop: 8 }}
                onClick={handleReset} disabled={resetting}>
                <RotateCcw size={12} /> Load Default Catalog
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Add Product Modal ─────────────────────────────────── */}
      {showNewProduct && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 660, maxHeight: '92vh', overflowY: 'auto', padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Package size={16} style={{ color: '#f97316' }} />
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Add New Product</h3>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)' }} onClick={() => setShowNewProduct(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.15)', borderRadius: 8, padding: '8px 12px', marginBottom: 14, display: 'flex', gap: 8 }}>
              <Brain size={13} style={{ color: '#2563eb', flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                Fill in the Description field thoroughly — include pricing, batch modes, who this is for, and key selling points. The AI uses this to answer lead queries during calls.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="input-group">
                  <label className="input-label">Product Name *</label>
                  <input className="input" autoFocus placeholder="e.g. Cyber Security" value={newProduct.name}
                    onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="input-group">
                  <label className="input-label">Category</label>
                  <select className="input" value={newProduct.category}
                    onChange={e => setNewProduct(p => ({ ...p, category: e.target.value }))}>
                    {['Training', 'Corporate', 'Software', 'Service', 'Consulting'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="input-group">
                <label className="input-label">Description — AI reads this during calls ⭐</label>
                <textarea className="input" rows={5} style={{ resize: 'vertical' }}
                  placeholder="Write a detailed description: what the course covers, who it's for, duration, fee, batch modes, placement support, certification, salary prospects, key selling points. The richer the better."
                  value={newProduct.description}
                  onChange={e => setNewProduct(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div className="input-group">
                <label className="input-label">Key Features (add each individually)</label>
                {newProduct.key_features.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input className="input" style={{ flex: 1, fontSize: 12 }} value={f} placeholder={`Feature ${i + 1}`}
                      onChange={e => setNewProduct(p => ({ ...p, key_features: updFeature(p.key_features, i, e.target.value) }))} />
                    <button onClick={() => setNewProduct(p => ({ ...p, key_features: delFeature(p.key_features, i) }))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4 }}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button className="btn btn-secondary btn-sm" style={{ fontSize: 11, gap: 4, display: 'flex', alignItems: 'center' }}
                  onClick={() => setNewProduct(p => ({ ...p, key_features: addFeature(p.key_features) }))}>
                  <Plus size={11} /> Add Feature
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="input-group">
                  <label className="input-label">Duration</label>
                  <input className="input" placeholder="e.g. 3 Months" value={newProduct.duration}
                    onChange={e => setNewProduct(p => ({ ...p, duration: e.target.value }))} />
                </div>
                <div className="input-group">
                  <label className="input-label">Fee Range</label>
                  <input className="input" placeholder="e.g. ₹25,000 – ₹40,000" value={newProduct.fee_range}
                    onChange={e => setNewProduct(p => ({ ...p, fee_range: e.target.value }))} />
                </div>
              </div>
              <div className="input-group">
                <label className="input-label">Target Audience</label>
                <input className="input" placeholder="Who should enroll in this?" value={newProduct.target_audience}
                  onChange={e => setNewProduct(p => ({ ...p, target_audience: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="input-group">
                  <label className="input-label">Prerequisites</label>
                  <input className="input" placeholder="Prior knowledge needed" value={newProduct.prerequisites}
                    onChange={e => setNewProduct(p => ({ ...p, prerequisites: e.target.value }))} />
                </div>
                <div className="input-group">
                  <label className="input-label">Certification</label>
                  <input className="input" placeholder="Certificate name" value={newProduct.certification}
                    onChange={e => setNewProduct(p => ({ ...p, certification: e.target.value }))} />
                </div>
              </div>
              <div className="input-group">
                <label className="input-label">Career Opportunities</label>
                <input className="input" placeholder="e.g. Data Scientist, ML Engineer..." value={newProduct.career_opportunities}
                  onChange={e => setNewProduct(p => ({ ...p, career_opportunities: e.target.value }))} />
              </div>
              <div className="input-group">
                <label className="input-label">Batch Types</label>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {['Classroom', 'Online Live', 'Hybrid', 'Weekend'].map(type => (
                    <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={(newProduct.batch_types || []).includes(type)}
                        onChange={() => toggleBatch(newProduct, setNewProduct, type)} />
                      {type}
                    </label>
                  ))}
                </div>
              </div>

              {/* Screening Questions Editor */}
              <div className="input-group" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label className="input-label" style={{ marginBottom: 0 }}>
                    Screening / Qualification Questions (ask candidate one by one during calls)
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: 11, gap: 4, display: 'flex', alignItems: 'center', padding: '4px 8px' }}
                    onClick={handleGenerateQuestionsForNew}
                    disabled={generatingQuestions}
                  >
                    <Brain size={12} style={{ color: '#2563eb' }} />
                    {generatingQuestions ? 'Generating...' : 'Auto-Generate with AI'}
                  </button>
                </div>
                {(newProduct.questions || []).map((q, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', minWidth: 24, paddingTop: 8 }}>Q{i+1}</span>
                    <input className="input" style={{ flex: 1, fontSize: 12 }} value={q} placeholder={`Question ${i + 1}`}
                      onChange={e => setNewProduct(p => ({ ...p, questions: updQuestion(p.questions, i, e.target.value) }))} />
                    <button onClick={() => setNewProduct(p => ({ ...p, questions: delQuestion(p.questions, i) }))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4 }}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button className="btn btn-secondary btn-sm" style={{ fontSize: 11, gap: 4, display: 'flex', alignItems: 'center', alignSelf: 'flex-start' }}
                  onClick={() => setNewProduct(p => ({ ...p, questions: addQuestion(p.questions) }))}>
                  <Plus size={11} /> Add Question
                </button>
              </div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={newProduct.emi_available}
                    onChange={e => setNewProduct(p => ({ ...p, emi_available: e.target.checked }))} />
                  EMI / Installment Available
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={newProduct.placement_support}
                    onChange={e => setNewProduct(p => ({ ...p, placement_support: e.target.checked }))} />
                  Placement Support Included
                </label>
              </div>
              {newProduct.name.trim() && (
                <div style={{ fontSize: 11, color: 'var(--text-4)', background: 'var(--bg-2)', padding: '6px 10px', borderRadius: 6 }}>
                  Auto Code: <strong style={{ color: '#f97316', fontFamily: 'monospace' }}>{newProduct.name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4).padEnd(4, 'X')}####</strong> (generated on save)
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowNewProduct(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={handleAddProduct} disabled={saving || !newProduct.name.trim()}>
                  {saving ? 'Saving...' : '+ Add Product'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Service Modal ─────────────────────────────────── */}
      {showNewService && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 520, padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <BookOpen size={16} style={{ color: '#2563eb' }} />
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Add New Service</h3>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)' }} onClick={() => setShowNewService(false)}>
                <X size={18} />
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', background: 'var(--bg-2)', padding: '7px 10px', borderRadius: 8, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Package size={11} style={{ color: 'var(--text-4)' }} />
              Linked to product: <strong>{selected?.name}</strong>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="input-group">
                  <label className="input-label">Service Name *</label>
                  <input className="input" autoFocus placeholder="e.g. Weekend Batch" value={newService.name}
                    onChange={e => setNewService(s => ({ ...s, name: e.target.value }))} />
                </div>
                <div className="input-group">
                  <label className="input-label">Service Type</label>
                  <select className="input" value={newService.type}
                    onChange={e => setNewService(s => ({ ...s, type: e.target.value }))}>
                    {['Classroom', 'Online Live', 'Hybrid', 'Placement', 'Certification', 'Career Counseling', 'Demo Session', 'Alumni', 'Service'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="input-group">
                <label className="input-label">Description (AI uses this to explain this service to leads)</label>
                <textarea className="input" rows={3} style={{ resize: 'vertical' }}
                  placeholder="What does this service include? Delivery format, schedule, what's covered, what's included..."
                  value={newService.description}
                  onChange={e => setNewService(s => ({ ...s, description: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="input-group">
                  <label className="input-label">Duration</label>
                  <input className="input" placeholder="e.g. 6 Months" value={newService.duration}
                    onChange={e => setNewService(s => ({ ...s, duration: e.target.value }))} />
                </div>
                <div className="input-group">
                  <label className="input-label">Fee</label>
                  <input className="input" placeholder="e.g. ₹45,000 or Included" value={newService.fee}
                    onChange={e => setNewService(s => ({ ...s, fee: e.target.value }))} />
                </div>
              </div>
              {newService.name.trim() && (
                <div style={{ fontSize: 11, color: 'var(--text-4)', background: 'var(--bg-2)', padding: '6px 10px', borderRadius: 6 }}>
                  Auto Code: <strong style={{ color: '#2563eb', fontFamily: 'monospace' }}>{newService.name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4).padEnd(4, 'X')}####</strong>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowNewService(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={handleAddService} disabled={saving || !newService.name.trim()}>
                  {saving ? 'Saving...' : '+ Add Service'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
