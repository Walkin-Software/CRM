/**
 * App Root — Routing, auth guards, and layout composition.
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import LeadDetail from './pages/LeadDetail';
import CallLogs from './pages/CallLogs';
import Scheduling from './pages/Scheduling';
import Analytics from './pages/Analytics';
import Notifications from './pages/Notifications';
import FollowUpQueue from './pages/FollowUpQueue';
import WhatsAppChat from './pages/WhatsAppChat';
import PublicIntakeForm from './pages/PublicIntakeForm';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'var(--bg-base)' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ width:48, height:48, borderRadius:'50%', background:'var(--gradient-brand)', margin:'0 auto 16px', animation:'pulse 1.5s infinite' }} />
        <p style={{ color:'var(--text-muted)', fontSize:14 }}>Loading...</p>
      </div>
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
            },
          }}
        />
        <Routes>
          <Route path="/login"  element={<Login />} />
          <Route path="/intake" element={<PublicIntakeForm />} />
          <Route path="/" element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }>
            <Route index                  element={<Dashboard />} />
            <Route path="leads"           element={<Leads />} />
            <Route path="leads/:id"       element={<LeadDetail />} />
            <Route path="calls"           element={<CallLogs />} />
            <Route path="schedule"        element={<Scheduling />} />
            <Route path="analytics"       element={<Analytics />} />
            <Route path="notifications"   element={<Notifications />} />
            <Route path="follow-ups"      element={<FollowUpQueue />} />
            <Route path="whatsapp"        element={<WhatsAppChat />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
