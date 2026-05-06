import { useEffect, useState } from 'react';
import { Calendar as CalendarIcon, Clock, Plus, User, Check, AlertCircle } from 'lucide-react';
import { schedulingAPI } from '../lib/api';
import { toast } from 'react-hot-toast';

export default function Scheduling() {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('today');

  useEffect(() => {
    async function fetchSlots() {
      try {
        const res = await schedulingAPI.slots();
        setSlots(res.data.slots);
      } catch (err) {
        toast.error('Failed to load slots');
      } finally {
        setLoading(false);
      }
    }
    fetchSlots();
  }, []);

  const today = new Date();
  const weekEnd = new Date();
  weekEnd.setDate(today.getDate() + 7);

  const visibleSlots = slots.filter((slot) => {
    const startsAt = new Date(slot.starts_at);
    if (viewMode === 'today') {
      return startsAt.toDateString() === today.toDateString();
    }
    return startsAt >= today && startsAt <= weekEnd;
  });

  const upcomingRows = visibleSlots.slice(0, 4);

  const formatDate = (dateString) => new Date(dateString).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const formatTime = (dateString) => new Date(dateString).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex-col gap-6">
      <div className="page-header">
        <div>
          <h2 className="page-title">Scheduling & Availability</h2>
          <p className="page-subtitle">Manage agent slots and demo bookings</p>
        </div>
        <button className="btn btn-primary">
          <Plus size={18} /> New Slot
        </button>
      </div>

      <div className="scheduling-layout">
        <div className="card scheduling-slots-card">
          <div className="scheduling-card-header">
            <h3 className="chart-title">Available Time Slots</h3>
            <div className="scheduling-segment">
              <button
                className={`btn btn-sm ${viewMode === 'today' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setViewMode('today')}
              >
                Today
              </button>
              <button
                className={`btn btn-sm ${viewMode === 'week' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setViewMode('week')}
              >
                Week
              </button>
            </div>
          </div>

          <div className="scheduling-slot-list">
            {loading ? (
              <>
                <div className="skeleton" style={{ height: '84px' }} />
                <div className="skeleton" style={{ height: '84px' }} />
                <div className="skeleton" style={{ height: '84px' }} />
              </>
            ) : visibleSlots.length === 0 ? (
              <div className="scheduling-empty">
                <CalendarIcon size={20} className="text-muted" />
                <p className="text-sm">No slots available for this view.</p>
              </div>
            ) : (
              visibleSlots.map((slot) => (
                <div key={slot.id} className="scheduling-slot-row">
                  <div className="scheduling-slot-main">
                    <div className="scheduling-slot-icon">
                      <CalendarIcon size={18} className="text-muted" />
                    </div>
                    <div>
                      <div className="scheduling-slot-date">{formatDate(slot.starts_at)}</div>
                      <div className="scheduling-slot-time">
                        <Clock size={12} />
                        {formatTime(slot.starts_at)} - {formatTime(slot.ends_at)}
                      </div>
                    </div>
                  </div>
                  <div className="scheduling-slot-meta">
                    <div className="scheduling-slot-agent">
                      <User size={14} className="text-muted" />
                      <span>Agent: {slot.agent_id}</span>
                    </div>
                    <div className="badge badge-converted">Available</div>
                    <button className="btn btn-secondary btn-sm">Edit</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card scheduling-bookings-card">
          <h3 className="chart-title mb-4">Upcoming Bookings</h3>
          <div className="scheduling-booking-list">
            {loading ? (
              <>
                <div className="skeleton" style={{ height: '96px' }} />
                <div className="skeleton" style={{ height: '96px' }} />
              </>
            ) : upcomingRows.length === 0 ? (
              <div className="scheduling-empty">
                <AlertCircle size={18} className="text-muted" />
                <p className="text-sm">No upcoming bookings yet.</p>
              </div>
            ) : (
              upcomingRows.map((slot) => (
                <div key={slot.id} className="scheduling-booking-row">
                  <div className="scheduling-booking-head">
                    <div>
                      <div className="scheduling-booking-title">Slot {formatDate(slot.starts_at)}</div>
                      <div className="text-xs text-muted">{formatTime(slot.starts_at)} - {formatTime(slot.ends_at)}</div>
                    </div>
                    <span className="text-success"><Check size={14} /></span>
                  </div>
                  <div className="scheduling-booking-actions">
                    <button className="btn btn-secondary btn-sm w-full">Reschedule</button>
                    <button className="btn btn-danger btn-sm btn-icon" title="Cancel">
                      <AlertCircle size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
