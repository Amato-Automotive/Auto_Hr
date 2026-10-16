import React, { useEffect, useState } from 'react';
import { ChevronRight, LogOut, MoreHorizontal } from 'lucide-react';

export interface MobileTab {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

/**
 * Phone/tablet navigation (below lg): an iOS-style frosted tab bar with the four main pages
 * plus "More", which opens a frosted bottom sheet with the other pages and Sign out.
 * My Profile is the avatar in the mobile top bar. Desktop keeps the sidebar.
 */
export const MobileTabBar: React.FC<{
  primary: MobileTab[];
  more: MobileTab[];
  activeTab: string;
  onSelect: (id: string) => void;
  onSignOut: () => void;
}> = ({ primary, more, activeTab, onSelect, onSignOut }) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const moreActive = more.some(tab => tab.id === activeTab);
  const moreBadge = more.reduce((total, tab) => total + (tab.badge ?? 0), 0);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setSheetOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  const choose = (id: string) => {
    setSheetOpen(false);
    onSelect(id);
  };

  return (
    <>
      {/* More sheet */}
      {sheetOpen && (
        <div className="lg:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="More">
          <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-[2px] animate-backdrop-in" onClick={() => setSheetOpen(false)} />
          <div className="mobile-glass absolute inset-x-0 bottom-0 rounded-t-[28px] border-t border-white/70 shadow-[0_-12px_40px_rgba(15,23,42,0.12)] pb-[calc(env(safe-area-inset-bottom)+0.75rem)] animate-sheet-up">
            <div className="mx-auto mt-2.5 mb-3 h-1.5 w-10 rounded-full bg-slate-300/80" />

            {/* Other pages (My Profile is the avatar in the top bar) */}
            <div className="mx-4 rounded-2xl bg-white/60 divide-y divide-slate-200/60 overflow-hidden">
              {more.map(tab => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => choose(tab.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-white/90 ${active ? 'text-[#f46617]' : 'text-slate-700'}`}
                  >
                    <tab.icon className={`w-5 h-5 ${active ? 'text-[#f46617]' : 'text-slate-400'}`} />
                    <span className="flex-1 text-[15px] font-semibold">{tab.label}</span>
                    {tab.badge ? (
                      <span className="bg-[#f46617] text-white text-[11px] font-black px-2 py-0.5 rounded-full">{tab.badge}</span>
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 mx-4">
              <button
                type="button"
                onClick={() => { setSheetOpen(false); onSignOut(); }}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white/60 active:bg-white/90 text-[15px] font-bold text-slate-600"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <nav
        aria-label="Main"
        className="mobile-glass lg:hidden fixed inset-x-0 bottom-0 z-50 border-t border-white/70 shadow-[0_-1px_0_rgba(15,23,42,0.06)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-5 h-[60px]">
          {[...primary, { id: '__more', label: 'More', icon: MoreHorizontal, badge: moreBadge }].map(tab => {
            const isMore = tab.id === '__more';
            const active = isMore ? moreActive || sheetOpen : activeTab === tab.id && !sheetOpen;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => (isMore ? setSheetOpen(open => !open) : choose(tab.id))}
                aria-current={active && !isMore ? 'page' : undefined}
                className="relative flex flex-col items-center justify-center gap-1 select-none"
              >
                <span className="relative">
                  <tab.icon className={`w-6 h-6 transition-colors ${active ? 'text-[#f46617]' : 'text-slate-400'}`} />
                  {tab.badge ? (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#f46617] text-white text-[10px] font-black rounded-full ring-2 ring-white">
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  ) : null}
                </span>
                <span className={`text-[10px] font-semibold leading-none ${active ? 'text-[#f46617]' : 'text-slate-500'}`}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
