import { X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ProfileView } from '../pages/Profile';

type Tab = 'about' | 'performance' | 'leaves' | 'attendance' | 'documents';

export const ProfileDrawer: React.FC<{
  employeeId: number;
  initialTab?: Tab;
  onClose: () => void;
  onEmployeeRemoved?: () => void;
  onChanged?: () => void;
}> = ({ employeeId, initialTab = 'about', onClose, onEmployeeRemoved, onChanged }) => {
  const [currentEmployeeId, setCurrentEmployeeId] = useState(employeeId);
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    setCurrentEmployeeId(employeeId);
  }, [employeeId]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const title = useMemo(() => {
    if (tab === 'leaves') return 'Leaves';
    if (tab === 'performance') return 'Performance';
    if (tab === 'attendance') return 'Attendance';
    if (tab === 'documents') return 'Documents';
    return 'Profile';
  }, [tab]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] font-sans">
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 w-full max-w-[1000px] bg-white border-l border-orange-100 shadow-2xl animate-slide-in">
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-5 border-b border-orange-100 bg-orange-50/20 backdrop-blur">
            <p className="text-xs font-bold tracking-wider text-[#f46617] uppercase">{title}</p>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-orange-55 text-slate-550 hover:text-slate-700 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="px-3 py-4 sm:px-6 sm:py-6">
              <ProfileView
                employeeId={currentEmployeeId}
                initialTab={tab}
                theme="light"
                onBack={onClose}
                hideBack
                onOpenEmployee={(id) => setCurrentEmployeeId(id)}
                onEmployeeRemoved={onEmployeeRemoved}
                onChanged={onChanged}
              />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
