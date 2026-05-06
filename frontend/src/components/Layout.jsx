/**
 * App Layout — Sidebar + Topbar + Main Content shell.
 */

import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, Users, Phone, Calendar, BarChart3,
  Bell, LogOut, Bot, ChevronRight, Settings
} from 'lucide-react';

const NAV = [
  { label: 'Overview',      to: '/',             icon: LayoutDashboard },
  { label: 'Leads',         to: '/leads',         icon: Users },
  { label: 'Call Logs',     to: '/calls',         icon: Phone },
  { label: 'Scheduling',    to: '/schedule',      icon: Calendar },
  { label: 'Analytics',     to: '/analytics',     icon: BarChart3 },
  { label: 'Notifications', to: '/notifications', icon: Bell },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const currentPage = NAV.find(n =>
    n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)
  );

  return (
    <div className="app-shell">
      {/* ── Sidebar ──────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">🤖</div>
          <div>
            <h1>PhoneAgent<br/><span>AI</span></h1>
          </div>
        </div>

        <span className="sidebar-section-label">Main</span>

        {NAV.map(({ label, to, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Icon className="nav-icon" />
            {label}
          </NavLink>
        ))}

        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', marginBottom:8 }}>
            <div className="avatar" style={{ width:32, height:32, fontSize:12 }}>
              {user?.full_name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div style={{ flex:1, overflow:'hidden' }}>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {user?.full_name || 'User'}
              </div>
              <div style={{ fontSize:11, color:'var(--text-muted)' }}>{user?.role_id ? 'Admin' : 'Agent'}</div>
            </div>
          </div>
          <button className="nav-item" onClick={logout} style={{ width:'100%', background:'none', border:'none' }}>
            <LogOut className="nav-icon" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── Topbar ───────────────────────────────────────── */}
      <header className="topbar">
        <div>
          <div className="topbar-title">{currentPage?.label || 'Dashboard'}</div>
          <div className="topbar-subtitle">AI Phone Agent Platform</div>
        </div>
        <div className="topbar-actions">
          <div className="live-badge">
            <div className="live-pulse" />
            System Online
          </div>
        </div>
      </header>

      {/* ── Main Content ─────────────────────────────────── */}
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
