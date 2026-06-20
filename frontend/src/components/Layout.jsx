import { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, Users, Phone, Calendar, BarChart3,
  Bell, LogOut, ClipboardList, MessageSquare,
  Search, Eye, Share2, Brain, UserCheck, Ticket, HelpCircle, Sparkles,
  ChevronLeft, ChevronRight, Package
} from 'lucide-react';
import { notificationsAPI } from '../lib/api';
import CopilotChat from './CopilotChat';

const NAV = [
  { label: 'Overview',             to: '/',             icon: LayoutDashboard, subtitle: "Here's what's happening with your business today." },
  { label: 'Visitor Intelligence', to: '/visitors',     icon: Eye,             subtitle: "Analyze user behaviors, browser metrics, and page visits." },
  { label: 'Social Leads',         to: '/social-leads', icon: Share2,          subtitle: "Track leads generated from active social media channels." },
  { label: 'AI Training',          to: '/ai-training',  icon: Brain, badge: 'New', subtitle: "Train and evaluate your business conversational agents." },
  { label: 'Products & Services', to: '/products',     icon: Package, badge: 'New', subtitle: "Manage your business's dynamic product and service catalog." },
  { label: 'Leads',                to: '/leads',        icon: Users,           subtitle: "Manage, filter, and track your customer leads database." },
  { label: 'Customers',            to: '/customers',    icon: UserCheck, badge: 'New', subtitle: "Active, lost, and premium customer profiles." },
  { label: 'Customer Tickets',     to: '/tickets',      icon: Ticket, badge: 'New', subtitle: "Manage client support requests and SLA escalations." },
  { label: 'Call Logs',            to: '/calls',        icon: Phone,           subtitle: "View and filter voice interaction histories." },
  { label: 'WhatsApp',             to: '/whatsapp',     icon: MessageSquare,   subtitle: "Interactive WhatsApp chat channels and templates." },
  { label: 'Follow-Ups',           to: '/follow-ups',   icon: ClipboardList,   subtitle: "Organize and track upcoming customer follow-up actions." },
  { label: 'Scheduling',           to: '/schedule',     icon: Calendar,        subtitle: "Coordinate meetings, calendar events, and booking slots." },
  { label: 'Analytics',            to: '/analytics',    icon: BarChart3,       subtitle: "Examine deep metrics, performance levels, and KPI goals." },
  { label: 'Notifications',        to: '/notifications', icon: Bell,            subtitle: "Messaging templates and dispatch log history." },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Dropdown & focus states
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [searchVal, setSearchVal] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [copilotOpen, setCopilotOpen] = useState(false);

  const searchInputRef = useRef(null);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sidebar_collapsed', String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const currentPage = NAV.find(n =>
    n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)
  );

  // Keyboard shortcut listener Ctrl+K or Cmd+K
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch actual notifications for count and dropdown
  useEffect(() => {
    async function loadNotifications() {
      try {
        const res = await notificationsAPI.history({ page: 1, page_size: 5 });
        setRecentNotifications(res.data?.items || []);
        
        const countRes = await notificationsAPI.unreadCount();
        setUnreadCount(countRes.data?.unread_count || 0);
      } catch (err) {
        console.error('Failed to load notifications in layout:', err);
      }
    }
    loadNotifications();
  }, [location.pathname]); // Reload when changing pages

  const handleSearchSubmit = (e) => {
    if (e.key === 'Enter' && searchVal.trim()) {
      navigate(`/leads?q=${encodeURIComponent(searchVal.trim())}`);
      setSearchVal('');
      searchInputRef.current?.blur();
    }
  };

  return (
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`} style={{ position: 'relative' }}>
      {/* Close dropdowns when clicking outside */}
      {(profileOpen || notificationsOpen) && (
        <div 
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'transparent' }} 
          onClick={() => { setProfileOpen(false); setNotificationsOpen(false); }}
        />
      )}

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        {/* Navigation Section */}
        <span className="sidebar-section-label">Navigation</span>

        <div className="sidebar-nav-wrap">
          {NAV.map(({ label, to, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              title={sidebarCollapsed ? label : undefined}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon className="nav-icon" size={15} style={{ flexShrink: 0 }} />
              <span className="nav-label">{label}</span>
              {badge && (
                <span className="badge nav-badge-pill" style={{
                  background: 'rgba(124, 58, 237, 0.08)',
                  color: '#7c3aed',
                  fontSize: '9px',
                  fontWeight: '700',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  border: '1px solid rgba(124, 58, 237, 0.15)',
                  textTransform: 'uppercase',
                }}>
                  {badge}
                </span>
              )}
            </NavLink>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="copilot-card">
            <span className="copilot-badge">Beta</span>
            <div className="copilot-card-head">
              <Sparkles size={14} />
              <span>PRAVESHA AI Copilot</span>
            </div>
            <p className="copilot-text">
              Ask anything about your leads, calls, follow-ups and get AI powered insights.
            </p>
            <button type="button" className="copilot-btn" onClick={() => setCopilotOpen(true)}>
              <Sparkles size={11} />
              Chat with AI
            </button>
          </div>

          <button
            type="button"
            className="copilot-mini-btn"
            onClick={() => setCopilotOpen(true)}
            title="Chat with AI Copilot"
            aria-label="Chat with AI Copilot"
          >
            <Sparkles size={16} />
          </button>

          <div className="sidebar-profile">
            <button
              className="nav-item"
              onClick={logout}
              title={sidebarCollapsed ? 'Sign Out' : undefined}
            >
              <LogOut size={15} className="nav-icon" />
              <span className="sidebar-logout-label">Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      <button
        type="button"
        className="sidebar-toggle"
        onClick={toggleSidebar}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {/* ── Topbar ── */}
      <header className="topbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', background: '#ffffff', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="logo-icon-svg" style={{ width: 28, height: 28, fontSize: 13 }}>P</div>
          <h1 style={{ fontSize: '14.5px', fontWeight: '800', letterSpacing: '-0.02em', margin: 0, padding: 0 }}>
            PRAVESHA <span style={{ color: '#2563eb', fontWeight: '700' }}>AI</span>
          </h1>
          <span style={{ fontSize: '11px', color: 'var(--text-4)', paddingLeft: '8px', borderLeft: '1px solid var(--border)', fontWeight: '600' }}>
            {currentPage?.label || 'Dashboard'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Dynamic Search Capsule */}
          <div className="search-container">
            <Search className="input-icon" size={13} style={{ color: 'var(--text-4)', left: '10px' }} />
            <input 
              ref={searchInputRef}
              type="text" 
              placeholder="Search anything..." 
              className="search-input-capsule"
              style={{ paddingLeft: '30px' }}
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              onKeyDown={handleSearchSubmit}
            />
            <span className="search-shortcut">⌘ K</span>
          </div>

          {/* Quick actions with dropdowns */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
            <button className="topbar-icon-btn" onClick={() => navigate('/calls')}>
              <Phone size={15} />
            </button>
            
            {/* Bell/Notifications button */}
            <button 
              className="topbar-icon-btn" 
              onClick={() => { setNotificationsOpen(!notificationsOpen); setProfileOpen(false); }}
              style={{ background: notificationsOpen ? 'var(--bg-hover)' : 'none' }}
            >
              <Bell size={15} />
              {unreadCount > 0 && <span className="topbar-icon-badge">{unreadCount}</span>}
            </button>
            
            <button className="topbar-icon-btn" onClick={() => navigate('/schedule')}>
              <HelpCircle size={15} />
            </button>

            {/* Dynamic notifications drop card */}
            {notificationsOpen && (
              <div style={{
                position: 'absolute',
                top: '40px',
                right: '24px',
                background: 'white',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                boxShadow: 'var(--shadow-md)',
                padding: '12px',
                width: '280px',
                zIndex: 100,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-1)' }}>Recent Notifications</span>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button 
                      style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '10px', fontWeight: '600', cursor: 'pointer', padding: 0 }} 
                      onClick={async () => {
                        try {
                          await notificationsAPI.markReadAll();
                          setUnreadCount(0);
                          const res = await notificationsAPI.history({ page: 1, page_size: 5 });
                          setRecentNotifications(res.data?.items || []);
                        } catch (err) {
                          console.error('Failed to mark all notifications read:', err);
                        }
                      }}
                    >
                      Mark all read
                    </button>
                    <span style={{ color: 'var(--border)', fontSize: '10px' }}>•</span>
                    <button 
                      style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '10px', fontWeight: '700', cursor: 'pointer', padding: 0 }} 
                      onClick={() => { navigate('/notifications'); setNotificationsOpen(false); }}
                    >
                      View All
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
                  {recentNotifications.length === 0 ? (
                    <span style={{ fontSize: '11px', color: 'var(--text-4)', textAlign: 'center', padding: '12px 0' }}>No recent notifications</span>
                  ) : recentNotifications.map((n) => (
                    <div 
                      key={n.id} 
                      style={{ 
                        display: 'flex', 
                        gap: '8px', 
                        padding: '6px 8px', 
                        borderBottom: '1px solid var(--bg-muted)', 
                        borderRadius: '4px',
                        cursor: 'pointer',
                        background: n.status !== 'read' ? 'rgba(37, 99, 235, 0.03)' : 'none',
                        transition: 'background 0.2s'
                      }}
                      onClick={async () => {
                        if (n.status !== 'read') {
                          try {
                            await notificationsAPI.markRead(n.id);
                            const countRes = await notificationsAPI.unreadCount();
                            setUnreadCount(countRes.data?.unread_count || 0);
                            const res = await notificationsAPI.history({ page: 1, page_size: 5 });
                            setRecentNotifications(res.data?.items || []);
                          } catch (err) {
                            console.error('Failed to mark notification as read:', err);
                          }
                        }
                        navigate('/notifications');
                        setNotificationsOpen(false);
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = n.status !== 'read' ? 'rgba(37, 99, 235, 0.03)' : 'none'}
                    >
                      <div style={{ fontSize: '11px', flex: 1, minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ fontWeight: '700', color: 'var(--text-1)', textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {n.status !== 'read' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563eb', display: 'inline-block' }} />}
                          {n.channel} dispatch
                        </div>
                        <div style={{ color: 'var(--text-3)', fontSize: '10px', marginTop: '1px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {n.recipient_phone || n.recipient_email || 'Dispatch logged'}
                        </div>
                      </div>
                      <span className={`badge ${n.status === 'failed' ? 'badge-lost' : (n.status === 'read' ? 'badge-new' : 'badge-converted')}`} style={{ fontSize: '8px', padding: '2px 4px', height: 'fit-content' }}>
                        {n.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* User profile section dropdown */}
          <div style={{ position: 'relative' }}>
            <div 
              style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12, borderLeft: '1px solid var(--border)', cursor: 'pointer' }}
              onClick={() => { setProfileOpen(!profileOpen); setNotificationsOpen(false); }}
            >
              <div className="avatar" style={{ width: 26, height: 26, fontSize: 10, background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontWeight: '700', flexShrink: 0 }}>
                {user?.full_name?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <span style={{ fontSize: '12.5px', fontWeight: '600', color: 'var(--text-1)' }}>{user?.full_name || 'User'}</span>
              <span style={{ color: 'var(--text-4)', fontSize: '8px' }}>▼</span>
            </div>

            {/* Dynamic Profile drop card */}
            {profileOpen && (
              <div style={{
                position: 'absolute',
                top: '40px',
                right: '0',
                background: 'white',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                boxShadow: 'var(--shadow-md)',
                padding: '6px',
                width: '160px',
                zIndex: 100,
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}>
                <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>
                  <div style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--text-1)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{user?.full_name || 'User'}</div>
                  <div style={{ fontSize: '9.5px', color: 'var(--text-4)', marginTop: '2px' }}>{user?.role_id ? 'Super Admin' : 'Agent'}</div>
                </div>
                <button 
                  onClick={() => { navigate('/leads'); setProfileOpen(false); }}
                  className="nav-item" 
                  style={{ width: 'calc(100% - 8px)', margin: '2px 4px', padding: '6px 8px', fontSize: '12px', textAlign: 'left', display: 'flex', gap: '8px', alignItems: 'center', border: 'none', background: 'none' }}
                >
                  <Users size={13} style={{ color: 'var(--text-3)' }} />
                  Leads
                </button>
                <button 
                  onClick={() => { navigate('/notifications'); setProfileOpen(false); }}
                  className="nav-item" 
                  style={{ width: 'calc(100% - 8px)', margin: '2px 4px', padding: '6px 8px', fontSize: '12px', textAlign: 'left', display: 'flex', gap: '8px', alignItems: 'center', border: 'none', background: 'none' }}
                >
                  <Bell size={13} style={{ color: 'var(--text-3)' }} />
                  Alerts
                </button>
                <button 
                  onClick={() => { logout(); setProfileOpen(false); }}
                  className="nav-item" 
                  style={{ width: 'calc(100% - 8px)', margin: '2px 4px', padding: '6px 8px', fontSize: '12px', textAlign: 'left', display: 'flex', gap: '8px', alignItems: 'center', border: 'none', background: 'none', color: 'var(--danger)' }}
                >
                  <LogOut size={13} style={{ color: 'var(--danger)' }} />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="main-content" style={{ background: 'var(--bg-base)' }}>
        <Outlet />
      </main>

      <CopilotChat open={copilotOpen} onClose={() => setCopilotOpen(false)} />
    </div>
  );
}
