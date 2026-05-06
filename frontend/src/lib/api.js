/**
 * API Client — Axios instance with JWT auth and base URL config.
 * All service calls go through this client.
 */

import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor: attach JWT from localStorage ────────
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor: handle 401 → auto refresh ─────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refresh_token = localStorage.getItem('refresh_token');
        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refresh_token });
        localStorage.setItem('access_token', data.access_token);
        original.headers.Authorization = `Bearer ${data.access_token}`;
        return api(original);
      } catch {
        localStorage.clear();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ── API Methods ───────────────────────────────────────────────

// Auth
export const authAPI = {
  login:   (data) => api.post('/auth/login', data),
  register:(data) => api.post('/auth/register', data),
  refresh: (data) => api.post('/auth/refresh', data),
  logout:  (data) => api.post('/auth/logout', data),
  me:      ()     => api.get('/users/me'),
};

// Leads
export const leadsAPI = {
  list:   (params) => api.get('/leads', { params }),
  get:    (id)     => api.get(`/leads/${id}`),
  create: (data)   => api.post('/leads', data),
  update: (id, d)  => api.patch(`/leads/${id}`, d),
  delete: (id)     => api.delete(`/leads/${id}`),
  notes:  {
    list:   (leadId)        => api.get(`/leads/${leadId}/notes`),
    create: (leadId, data)  => api.post(`/leads/${leadId}/notes`, data),
    delete: (leadId, noteId)=> api.delete(`/leads/${leadId}/notes/${noteId}`),
  },
  followUps: {
    list:   (leadId)       => api.get(`/leads/${leadId}/follow-ups`),
    create: (leadId, data) => api.post(`/leads/${leadId}/follow-ups`, data),
    update: (leadId, fuId, d)=> api.patch(`/leads/${leadId}/follow-ups/${fuId}`, d),
  },
};

// Calls
export const callsAPI = {
  list:     (params) => api.get('/calls', { params }),
  outbound: (data)   => api.post('/calls/outbound', data),
  end:      (sid)    => api.delete(`/calls/${sid}`),
  transcript: (id)   => api.get(`/calls/${id}/transcript`),
  recording:  (id)   => api.get(`/calls/${id}/recording`, { responseType: 'blob' }),
  download:   (id)   => api.get(`/calls/${id}/recording/download`, { responseType: 'blob' }),
};

// Scheduling
export const schedulingAPI = {
  slots:       (params) => api.get('/scheduling/slots/available', { params }),
  createSlot:  (data)   => api.post('/scheduling/slots', data),
  book:        (data)   => api.post('/scheduling/bookings', data),
  updateBook:  (id, d)  => api.patch(`/scheduling/bookings/${id}`, d),
};

// Notifications
export const notificationsAPI = {
  send:         (data) => api.post('/notifications/send', data),
  generateAndSend: (data) => api.post('/notifications/generate-and-send', data),
  sendTemplate: (data) => api.post('/notifications/send/template', data),
  sendBulk:     (data) => api.post('/notifications/send/bulk', data),
  templates:    ()     => api.get('/notifications/templates'),
  history:      (params) => api.get('/notifications/history', { params }),
};

export const aiAPI = {
  startScreening: (leadId) => api.post(`/ai/leads/${leadId}/screening/start`),
  submitScreening: (sessionId, data) => api.post(`/ai/screening/${sessionId}/submit`, data),
  latestScreening: (leadId) => api.get(`/ai/leads/${leadId}/screening/latest`),
};

// Analytics
export const analyticsAPI = {
  overview:    (params) => api.get('/analytics/overview', { params }),
  daily:       (params) => api.get('/analytics/daily', { params }),
  heatmap:     ()       => api.get('/analytics/calls/heatmap'),
  funnel:      ()       => api.get('/analytics/conversion-funnel'),
};

// Payments
export const paymentsAPI = {
  checkout: (data) => api.post('/payments/checkout', data),
  refund:   (data) => api.post('/payments/refund', data),
};

// Admin
export const adminAPI = {
  dashboardStats: () => api.get('/admin/dashboard/stats'),
  auditLogs:      (params) => api.get('/admin/audit-logs', { params }),
};
