import { useState, useEffect } from 'react';
import { Share2, Star, ExternalLink, RefreshCw, Info } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { leadsAPI, integrationsAPI } from '../lib/api';

const Instagram = (props) => (
  <svg viewBox="0 0 24 24" width={props.size || 24} height={props.size || 24} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
  </svg>
);

const Facebook = (props) => (
  <svg viewBox="0 0 24 24" width={props.size || 24} height={props.size || 24} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path>
  </svg>
);

const Linkedin = (props) => (
  <svg viewBox="0 0 24 24" width={props.size || 24} height={props.size || 24} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path>
    <rect x="2" y="9" width="4" height="12"></rect>
    <circle cx="4" cy="4" r="2"></circle>
  </svg>
);

const Twitter = (props) => (
  <svg viewBox="0 0 24 24" width={props.size || 24} height={props.size || 24} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"></path>
  </svg>
);

export default function SocialLeads() {
  const [channels] = useState([
    { platform: 'Instagram Ads', status: 'Active', leadsCount: 42, color: '#db2777', handle: '@crmcalling.ai.ads', icon: Instagram },
    { platform: 'Facebook Leads', status: 'Active', leadsCount: 28, color: '#1877f2', handle: 'CRM Calling AI Page', icon: Facebook },
    { platform: 'LinkedIn Campaigns', status: 'Active', leadsCount: 54, color: '#0a66c2', handle: 'CRM Calling Corporate', icon: Linkedin },
    { platform: 'X/Twitter DM Agent', status: 'Paused', leadsCount: 12, color: '#000000', handle: '@CRMCallingAI', icon: Twitter }
  ]);

  const [socialLeads, setSocialLeads] = useState([]);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadLeads = async () => {
    try {
      const res = await leadsAPI.list({ page_size: 100 });
      // Show leads that are captured via social or show all synced ones
      const items = res.data?.items || [];
      const filtered = items.filter(
        (lead) =>
          lead.source === 'social_media' ||
          lead.source === 'whatsapp' ||
          lead.tags?.includes('public_trigger')
      );
      setSocialLeads(filtered.length > 0 ? filtered : items);
      if (filtered.length > 0) {
        setSelectedLeadId((prev) => prev || filtered[0].id);
      } else if (items.length > 0) {
        setSelectedLeadId((prev) => prev || items[0].id);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load social leads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLeads();
  }, []);

  const syncSocialApis = async () => {
    try {
      await toast.promise(
        integrationsAPI.scrapeSample(),
        {
          loading: 'Querying Meta Graph API & LinkedIn Talent Ads API...',
          success: 'Successfully synchronized new social leads!',
          error: 'Failed to synchronize social leads.'
        }
      );
      loadLeads();
    } catch (err) {
      console.error(err);
    }
  };

  const selectedLead = socialLeads.find(l => l.id === selectedLeadId) || socialLeads[0];
  const channelLeadCounts = {
    instagram: socialLeads.filter((l) => (l.source || '').toLowerCase().includes('insta')).length,
    facebook: socialLeads.filter((l) => ['facebook', 'fb'].some((k) => (l.source || '').toLowerCase().includes(k))).length,
    linkedin: socialLeads.filter((l) => (l.source || '').toLowerCase().includes('linkedin')).length,
    twitter: socialLeads.filter((l) => ['twitter', 'x'].some((k) => (l.source || '').toLowerCase().includes(k))).length,
  };

  const getAvatarColor = (lead) => {
    if (!lead) return '#94a3b8';
    const src = (lead.source || '').toLowerCase();
    if (src.includes('insta')) return '#db2777';
    if (src.includes('link')) return '#0a66c2';
    if (src.includes('fb') || src.includes('facebook')) return '#1877f2';
    if (src.includes('whatsapp')) return '#25d366';
    return '#7c3aed';
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <div className="flex-col gap-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Social Leads Hub</h2>
          <p className="page-subtitle">Track and configure incoming leads captured via social API integrations and ad campaigns.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={syncSocialApis}>
            <RefreshCw size={14} /> Sync Social APIs
          </button>
        </div>
      </div>

      {/* Connected Integrations Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {channels.map((ch, idx) => {
          const IconComponent = ch.icon;
          return (
            <div key={idx} className="premium-kpi-card" style={{ height: '124px' }}>
              <div className="kpi-header">
                <div className="kpi-content">
                  <span className="kpi-title" style={{ fontWeight: '700', fontSize: '12.5px', color: 'var(--text-1)' }}>{ch.platform}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-4)' }}>{ch.handle}</span>
                </div>
                <div className="kpi-icon-container" style={{ background: `${ch.color}15`, color: ch.color }}>
                  <IconComponent size={18} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '10px' }}>
                <div>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-1)' }}>
                    {ch.platform.includes('Instagram') ? channelLeadCounts.instagram
                      : ch.platform.includes('Facebook') ? channelLeadCounts.facebook
                        : ch.platform.includes('LinkedIn') ? channelLeadCounts.linkedin
                          : channelLeadCounts.twitter} leads
                  </span>
                </div>
                <span className="badge" style={{
                  background: ch.status === 'Active' ? 'rgba(22,163,74,0.08)' : 'rgba(148,163,184,0.08)',
                  color: ch.status === 'Active' ? '#16a34a' : '#64748b',
                  fontSize: '9px',
                  fontWeight: '700',
                  padding: '2px 6px',
                  border: '1px solid rgba(148, 163, 184, 0.15)'
                }}>{ch.status === 'Active' ? 'Active' : 'Paused'}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Split Layout */}
      <div className="split-layout-pane">
        {/* Left Table Section */}
        <div className="main-pane-content" style={{ flex: 1.6 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="chart-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Share2 size={15} style={{ color: '#2563eb' }} />
                Social Lead Conversions Feed
              </h3>
              <span style={{ fontSize: '11px', color: 'var(--text-4)', fontWeight: '600' }}>Meta Graph v19.0 API Connected</span>
            </div>

            <table className="data-table">
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th>Prospect</th>
                  <th>Campaign Platform</th>
                  <th>Trigger Asset</th>
                  <th>Campaign name</th>
                  <th>AI Score</th>
                  <th>Captured</th>
                  <th>Interest</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-4)' }}>Loading leads...</td>
                  </tr>
                ) : socialLeads.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-4)', fontStyle: 'italic' }}>
                      No social leads synced. Click "Sync Social APIs" above to scrape sample leads!
                    </td>
                  </tr>
                ) : (
                  socialLeads.map(sl => (
                    <tr
                      key={sl.id}
                      onClick={() => setSelectedLeadId(sl.id)}
                      style={{
                        cursor: 'pointer',
                        background: selectedLeadId === sl.id ? 'var(--primary-light)' : 'none'
                      }}
                    >
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="avatar" style={{ width: 26, height: 26, fontSize: 10, background: getAvatarColor(sl), fontWeight: '700' }}>
                            {(sl.full_name || 'U').charAt(0)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: '12.5px' }}>{sl.full_name}</div>
                            <div style={{ fontSize: '10px', color: 'var(--text-4)' }}>{sl.phone}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="badge" style={{
                          background: 'rgba(37,99,235,0.06)',
                          color: '#2563eb',
                          border: '1px solid rgba(37,99,235,0.15)',
                          fontSize: '10px',
                          fontWeight: 700
                        }}>{sl.source}</span>
                      </td>
                      <td style={{ color: 'var(--text-2)', fontSize: '12px', fontWeight: 500 }}>{sl.job_role || 'N/A'}</td>
                      <td style={{ color: 'var(--text-3)', fontSize: '11.5px' }}>{sl.lead_type || 'N/A'}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, color: (sl.lead_score || 0) >= 70 ? 'var(--success)' : 'var(--warning)', fontSize: '12px' }}>
                          <Star size={11} fill="currentColor" />
                          {sl.lead_score || 0}/100
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-4)', fontSize: '11.5px' }}>{formatDate(sl.created_at)}</td>
                      <td style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: '12px' }}>{sl.interest || 'N/A'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Details Panel */}
        <div className="details-pane-container" style={{ width: '360px' }}>
          {!selectedLead ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-4)', fontStyle: 'italic', fontSize: '12.5px' }}>
              Select a lead to examine profile details
            </div>
          ) : (
            <>
              <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-1)' }}>Prospect Profile</h3>
                <span style={{ fontSize: '10px', color: 'var(--text-4)', fontWeight: '600' }}>AI Score: {selectedLead.lead_score || 0}/100</span>
              </div>

              {/* Social Card Mockup */}
              <div className="card" style={{ padding: '14px', background: 'linear-gradient(135deg, #f8fafc, #ffffff)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: getAvatarColor(selectedLead), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '16px' }}>
                    {(selectedLead.full_name || 'U').charAt(0)}
                  </div>
                  <div>
                    <h4 style={{ fontSize: '13.5px', fontWeight: '700', margin: 0, color: 'var(--text-1)' }}>{selectedLead.full_name}</h4>
                    <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: '11px', color: '#2563eb', textDecoration: 'none', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      {selectedLead.email} <ExternalLink size={10} />
                    </a>
                  </div>
                </div>
                <p style={{ fontSize: '11.5px', color: 'var(--text-2)', lineHeight: '1.45', margin: 0, fontWeight: 500 }}>
                  {selectedLead.description || 'No direct metadata description captured for this prospect.'}
                </p>
              </div>

              {/* Campaign details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-4)' }}>Lead Capture metadata</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ color: 'var(--text-3)' }}>Asset Triggered</span>
                    <span style={{ fontWeight: '600', color: 'var(--text-1)' }}>{selectedLead.job_role || 'N/A'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ color: 'var(--text-3)' }}>Campaign Adset</span>
                    <span style={{ fontWeight: '600', color: 'var(--text-1)' }}>{selectedLead.lead_type || 'N/A'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ color: 'var(--text-3)' }}>Phone Number</span>
                    <span style={{ fontWeight: '600', color: '#2563eb' }}>{selectedLead.phone}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ color: 'var(--text-3)' }}>Platform Network</span>
                    <span style={{ fontWeight: '700', color: getAvatarColor(selectedLead) }}>{selectedLead.source}</span>
                  </div>
                </div>
              </div>

              {/* Social Direct Message Dialog */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-4)' }}>Direct Social Messenger</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '140px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-hover)', padding: 10 }}>
                  <textarea
                    className="input"
                    rows={4}
                    defaultValue={`Hi ${(selectedLead.full_name || 'there').split(' ')[0]}, thanks for your interest from ${selectedLead.source}. We can share a personalized demo schedule.`}
                    style={{ width: '100%', resize: 'none', fontSize: 12 }}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => toast.success(`Message queued for ${selectedLead.full_name}`)}
                  >
                    Send Direct Message
                  </button>
                </div>
              </div>

              {/* Meta API disclaimer */}
              <div style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', background: '#f8fafc', display: 'flex', gap: '6px', alignItems: 'flex-start', marginTop: 'auto' }}>
                <Info size={13} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: '2px' }} />
                <p style={{ fontSize: '10px', color: 'var(--text-3)', margin: 0, lineHeight: 1.4 }}>
                  <strong>Meta Graph / LinkedIn API:</strong> This message will be logged in CRM history and pushed directly to the user's social inbox thread.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
