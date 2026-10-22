import React from 'react';
import { CheckCircle2, CalendarCheck, Wallet } from 'lucide-react';

/**
 * Animated "person working at a desk" illustration for the login page.
 * Pure SVG + CSS (no image assets): typing hands, code appearing on the monitor,
 * blinking cursor, rising coffee steam, a ticking wall clock, a swaying plant and
 * floating HR status cards. Motion is disabled for users who prefer reduced motion.
 */
export const DeskIllustration: React.FC = () => (
  <div className="relative w-full mx-auto select-none" aria-hidden="true">
    <style>{`
      @keyframes desk-type { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      @keyframes desk-type-alt { 0%, 100% { transform: translateY(-3px); } 50% { transform: translateY(0); } }
      @keyframes desk-code { 0% { transform: scaleX(0); } 35%, 85% { transform: scaleX(1); } 100% { transform: scaleX(0); } }
      @keyframes desk-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
      @keyframes desk-steam { 0% { transform: translateY(6px); opacity: 0; } 40% { opacity: .7; } 100% { transform: translateY(-22px); opacity: 0; } }
      @keyframes desk-spin { to { transform: rotate(360deg); } }
      @keyframes desk-sway { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
      @keyframes desk-head { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-2.5deg); } }
      @keyframes desk-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
      @keyframes desk-pop { 0% { opacity: 0; transform: translateY(12px) scale(.96); } 100% { opacity: 1; transform: none; } }
      .desk-hand-l { animation: desk-type .45s ease-in-out infinite; transform-box: fill-box; }
      .desk-hand-r { animation: desk-type-alt .45s ease-in-out infinite; transform-box: fill-box; }
      .desk-code { transform-origin: left center; transform-box: fill-box; animation: desk-code 5s ease-in-out infinite; }
      .desk-cursor { animation: desk-blink 1s steps(1) infinite; }
      .desk-steam { animation: desk-steam 2.6s ease-out infinite; transform-box: fill-box; }
      .desk-hand-hour { transform-origin: 252px 58px; animation: desk-spin 60s linear infinite; }
      .desk-hand-min { transform-origin: 252px 58px; animation: desk-spin 8s linear infinite; }
      .desk-plant { transform-origin: 404px 236px; animation: desk-sway 4s ease-in-out infinite; }
      .desk-head { transform-origin: 336px 178px; animation: desk-head 3.2s ease-in-out infinite; }
      .desk-float { animation: desk-float 5s ease-in-out infinite, desk-pop .6s ease-out both; }
      @media (prefers-reduced-motion: reduce) {
        .desk-hand-l, .desk-hand-r, .desk-code, .desk-cursor, .desk-steam, .desk-hand-hour,
        .desk-hand-min, .desk-plant, .desk-head, .desk-float { animation: none !important; }
        .desk-code { transform: none; }
      }
    `}</style>

    <svg viewBox="0 0 480 400" className="w-full h-auto">
      <defs>
        <linearGradient id="desk-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e293b" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id="desk-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbbf8a" />
          <stop offset="1" stopColor="#f59e5b" />
        </linearGradient>
      </defs>

      {/* Backdrop shapes */}
      <circle cx="250" cy="190" r="150" fill="#fed7aa" opacity=".35" />
      <circle cx="400" cy="90" r="40" fill="#fde68a" opacity=".45" />

      {/* Wall clock */}
      <circle cx="252" cy="58" r="30" fill="#fff" stroke="#f46617" strokeWidth="5" />
      {[0, 90, 180, 270].map(a => (
        <rect key={a} x="250.5" y="32" width="3" height="6" rx="1.5" fill="#cbd5e1" transform={`rotate(${a} 252 58)`} />
      ))}
      <rect className="desk-hand-hour" x="250.5" y="42" width="3" height="17" rx="1.5" fill="#334155" />
      <rect className="desk-hand-min" x="251" y="36" width="2" height="23" rx="1" fill="#f46617" />
      <circle cx="252" cy="58" r="3" fill="#334155" />

      {/* Floor shadow */}
      <ellipse cx="240" cy="372" rx="200" ry="12" fill="#0f172a" opacity=".07" />

      {/* Chair */}
      <rect x="372" y="188" width="14" height="96" rx="7" fill="#475569" />
      <rect x="318" y="268" width="70" height="14" rx="7" fill="#64748b" />
      <rect x="349" y="282" width="8" height="62" fill="#475569" />
      <rect x="322" y="342" width="62" height="8" rx="4" fill="#475569" />
      <circle cx="326" cy="354" r="5" fill="#334155" />
      <circle cx="380" cy="354" r="5" fill="#334155" />

      {/* Person — legs */}
      <path d="M330 272 h-48 a10 10 0 0 0 -10 10 v58" stroke="#1e3a8a" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="258" y="336" width="30" height="12" rx="6" fill="#0f172a" />

      {/* Person — torso */}
      <path d="M312 200 q24 -10 44 2 l8 62 q-28 14 -60 6 z" fill="#f46617" />
      <path d="M326 196 l10 14 l10 -14" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".8" />

      {/* Person — head (gently nods while reading) */}
      {/* Side view, facing the monitor: neck, face, nose, ear, then hair over the top and back. */}
      <g className="desk-head">
        <rect x="331" y="174" width="12" height="18" rx="5" fill="#e8a87c" />
        <circle cx="338" cy="158" r="20" fill="#f2b98d" />
        <path d="M319 155 q-6 5 -1 9" fill="#f2b98d" stroke="#e8a87c" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M318 154 c0 -14 10 -22 22 -22 c13 0 21 9 21 22 c0 8 -3 15 -8 20 l-3 -14 c-8 -1 -16 -5 -22 -11 c-3 3 -6 5 -10 5 z" fill="#1f2937" />
        <ellipse cx="346" cy="161" rx="3.5" ry="5" fill="#e8a87c" />
        <path d="M322 152 h6" stroke="#1f2937" strokeWidth="2" strokeLinecap="round" />
        <circle cx="325" cy="158" r="2" fill="#1f2937" />
        <path d="M322 169 q3 2 7 0" stroke="#b45309" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>

      {/* Desk */}
      <rect x="54" y="262" width="300" height="14" rx="5" fill="url(#desk-top)" />
      <rect x="64" y="276" width="10" height="70" fill="#ea8a4a" />
      <rect x="330" y="276" width="10" height="70" fill="#ea8a4a" />
      <rect x="74" y="284" width="66" height="44" rx="6" fill="#fb923c" opacity=".55" />
      <rect x="99" y="303" width="16" height="4" rx="2" fill="#fff" opacity=".8" />

      {/* Monitor */}
      <rect x="190" y="232" width="12" height="30" fill="#94a3b8" />
      <rect x="168" y="258" width="56" height="6" rx="3" fill="#94a3b8" />
      <rect x="110" y="128" width="172" height="110" rx="10" fill="#334155" />
      <rect x="117" y="135" width="158" height="96" rx="6" fill="url(#desk-screen)" />
      {/* Code being typed */}
      {[
        { x: 128, y: 148, w: 60, c: '#fb923c', d: '0s' },
        { x: 140, y: 162, w: 90, c: '#38bdf8', d: '.35s' },
        { x: 140, y: 176, w: 54, c: '#a3e635', d: '.7s' },
        { x: 152, y: 190, w: 78, c: '#f472b6', d: '1.05s' },
        { x: 140, y: 204, w: 44, c: '#38bdf8', d: '1.4s' },
        { x: 128, y: 218, w: 28, c: '#fb923c', d: '1.75s' },
      ].map(line => (
        <rect key={line.y} className="desk-code" x={line.x} y={line.y} width={line.w} height="6" rx="3" fill={line.c} style={{ animationDelay: line.d }} />
      ))}
      <rect className="desk-cursor" x="160" y="216" width="3" height="10" fill="#f8fafc" />

      {/* Keyboard + typing hands */}
      <rect x="226" y="254" width="74" height="8" rx="3" fill="#cbd5e1" />
      {/* Arms bent at the elbow: far arm (darker) first, near arm on top. */}
      <path d="M342 208 L330 240 L290 252" stroke="#ea580c" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M330 206 L316 238 L268 250" stroke="#f46617" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <ellipse className="desk-hand-l" cx="260" cy="252" rx="9" ry="6" fill="#f2b98d" />
      <ellipse className="desk-hand-r" cx="283" cy="254" rx="9" ry="6" fill="#e8a87c" />

      {/* Coffee mug with steam */}
      <rect x="76" y="236" width="24" height="26" rx="5" fill="#fff" stroke="#e2e8f0" strokeWidth="2" />
      <path d="M100 242 q10 0 10 8 q0 8 -10 8" stroke="#e2e8f0" strokeWidth="3" fill="none" />
      <rect x="80" y="244" width="16" height="4" rx="2" fill="#f46617" />
      {[80, 88].map((x, i) => (
        <path
          key={x}
          className="desk-steam"
          d={`M${x} 230 q-4 -6 0 -12 q4 -6 0 -12`}
          stroke="#94a3b8"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          style={{ animationDelay: `${i * 1.3}s` }}
        />
      ))}

      {/* Plant */}
      <g className="desk-plant">
        <path d="M404 236 q-26 -24 -18 -58 q18 22 18 58" fill="#22c55e" />
        <path d="M404 236 q24 -30 14 -64 q-20 26 -14 64" fill="#16a34a" />
        <path d="M404 236 q-6 -34 4 -50 q8 22 -4 50" fill="#4ade80" />
      </g>
      <path d="M388 236 h32 l-5 32 h-22 z" fill="#f46617" />
      <rect x="386" y="232" width="36" height="7" rx="3" fill="#ea580c" />
      <rect x="380" y="268" width="48" height="6" rx="3" fill="#cbd5e1" />
    </svg>

    {/* Floating HR status cards */}
    <div className="desk-float absolute left-0 top-[16%] hidden sm:flex items-center gap-2.5 bg-white rounded-2xl shadow-xl shadow-orange-900/5 px-3.5 py-2.5" style={{ animationDelay: '0s, .2s' }}>
      <span className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><CheckCircle2 className="w-4 h-4" /></span>
      <span className="leading-tight">
        <span className="block text-[11px] font-black text-slate-800">Checked in</span>
        <span className="block text-[10px] font-semibold text-slate-400">09:24 AM · On time</span>
      </span>
    </div>
    <div className="desk-float absolute right-0 top-[2%] hidden sm:flex items-center gap-2.5 bg-white rounded-2xl shadow-xl shadow-orange-900/5 px-3.5 py-2.5" style={{ animationDelay: '-1.6s, .45s' }}>
      <span className="w-8 h-8 rounded-xl bg-orange-50 text-[#f46617] flex items-center justify-center"><CalendarCheck className="w-4 h-4" /></span>
      <span className="leading-tight">
        <span className="block text-[11px] font-black text-slate-800">Leave approved</span>
        <span className="block text-[10px] font-semibold text-slate-400">Fri, 2 days</span>
      </span>
    </div>
    <div className="desk-float absolute right-[2%] bottom-[22%] hidden sm:flex items-center gap-2.5 bg-white rounded-2xl shadow-xl shadow-orange-900/5 px-3.5 py-2.5" style={{ animationDelay: '-3.2s, .7s' }}>
      <span className="w-8 h-8 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center"><Wallet className="w-4 h-4" /></span>
      <span className="leading-tight">
        <span className="block text-[11px] font-black text-slate-800">Payslip ready</span>
        <span className="block text-[10px] font-semibold text-slate-400">Download anytime</span>
      </span>
    </div>
  </div>
);
