import React, { useEffect, useRef, useState } from 'react';
import { Bell, Clock, CheckCircle } from 'lucide-react';
import { notificationApi, type AppNotification } from '../services/api';

interface NotificationBellProps {
  notifications: AppNotification[];
  unreadCount: number;
  onRefresh: () => void;
  onViewAll: () => void;
  onOpenNotification: (notification: AppNotification) => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ notifications, unreadCount, onRefresh, onViewAll, onOpenNotification }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const recent = notifications.slice(0, 6);

  const handleOpen = async (notification: AppNotification) => {
    setOpen(false);
    if (!notification.readAt) {
      await notificationApi.markRead(notification.id);
      onRefresh();
    }
    onOpenNotification(notification);
  };

  const markAllRead = async () => {
    await notificationApi.markAllRead();
    onRefresh();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="relative p-2.5 rounded-2xl hover:bg-orange-50 text-slate-500 hover:text-[#f46617] transition-colors"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-[#f46617] text-white text-[10px] font-black leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Phones/tablets: full-width panel under the top bar (the bell sits at the left there); desktop: below the bell. */}
      {open && (
        <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+68px)] lg:absolute lg:inset-x-auto lg:right-0 lg:top-full mt-0 lg:mt-2 lg:w-80 max-h-[70dvh] lg:max-h-[28rem] bg-white rounded-3xl border border-orange-100/60 shadow-2xl overflow-hidden flex flex-col z-50 animate-scale-in">
          <div className="flex items-center justify-between px-5 py-4 border-b border-orange-100/60">
            <h3 className="text-sm font-black text-slate-800">Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-[#f46617] transition-colors"
              >
                <CheckCircle className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {recent.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Bell className="w-9 h-9 mx-auto mb-2 opacity-40" />
                <p className="text-xs font-semibold">No notifications yet</p>
              </div>
            ) : (
              recent.map(notification => (
                <button
                  type="button"
                  key={notification.id}
                  onClick={() => handleOpen(notification)}
                  className={`w-full text-left px-5 py-3.5 border-b border-orange-50 last:border-b-0 transition-colors ${
                    notification.readAt ? 'bg-white hover:bg-orange-50/40' : 'bg-orange-50/50 hover:bg-orange-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 p-1.5 rounded-lg bg-white border border-orange-100 text-[#f46617] flex-shrink-0">
                      <Clock className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-slate-800 truncate">{notification.title}</p>
                        {!notification.readAt && <span className="w-1.5 h-1.5 rounded-full bg-[#f46617] flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-snug">{notification.message}</p>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1.5">
                        {new Date(notification.createdAt).toLocaleString('en-IN')}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => { setOpen(false); onViewAll(); }}
            className="px-5 py-3 text-xs font-bold text-center text-[#f46617] hover:bg-orange-50 border-t border-orange-100/60 transition-colors"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
};
