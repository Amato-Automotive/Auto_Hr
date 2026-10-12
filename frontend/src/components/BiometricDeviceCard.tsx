import React, { useEffect, useState } from 'react';
import { Fingerprint, RefreshCw, Link2, AlertCircle, Check, Wifi } from 'lucide-react';
import { attendanceApi, type BiometricStatus } from '../services/api';

// The device reconnects about every minute, so anything older than this means it's offline.
const ONLINE_WITHIN_MS = 3 * 60 * 1000;
const POLL_MS = 60 * 1000;

function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`;
  return `${Math.floor(secs / 86400)} days ago`;
}

/** HR-only: live status of the biometric push receiver, linking punches for newly mapped employees, and re-allowing the office network. */
export const BiometricDeviceCard: React.FC = () => {
  const [status, setStatus] = useState<BiometricStatus | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reprocessing, setReprocessing] = useState(false);
  const [allowing, setAllowing] = useState(false);

  const load = async () => {
    try {
      const res = await attendanceApi.biometricStatus();
      if (res.data) setStatus(res.data);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Could not load device status');
    }
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const handleReprocess = async () => {
    setReprocessing(true);
    setNotice('');
    try {
      const res = await attendanceApi.reprocessBiometric();
      setNotice(res.message || 'Punches linked');
      await load();
    } catch (err: any) {
      setError(err.message || 'Reprocess failed');
    } finally {
      setReprocessing(false);
    }
  };

  const handleAllowNetwork = async () => {
    setAllowing(true);
    setNotice('');
    try {
      const res = await attendanceApi.allowOfficeNetwork();
      setNotice(res.message || 'Office network allowed');
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not update the office network');
    } finally {
      setAllowing(false);
    }
  };

  const device = status?.devices[0];
  const online = Boolean(device?.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < ONLINE_WITHIN_MS);

  return (
    <div className="bg-white rounded-[32px] p-6 border border-orange-100/50 shadow-card">
      <div className="flex items-start justify-between gap-4 mb-4">
        <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
          <Fingerprint className="w-5 h-5 text-[#f46617]" />
          Biometric Device
        </h3>
        <button
          type="button"
          onClick={load}
          className="p-2 rounded-xl text-slate-400 hover:text-[#f46617] hover:bg-orange-50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 font-semibold text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-700 font-semibold text-xs">
          <Check className="w-4 h-4 flex-shrink-0" /> {notice}
        </div>
      )}

      {status && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-2xl bg-orange-50/40 border border-orange-100/40">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Status</p>
              <p className={`mt-1 text-sm font-black flex items-center gap-1.5 ${online ? 'text-emerald-600' : 'text-red-600'}`}>
                <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-500'}`} />
                {device ? (online ? 'Online' : 'Offline') : 'Never connected'}
              </p>
              {device?.lastSeenAt && <p className="text-[11px] text-slate-500 mt-0.5">Last seen {timeAgo(device.lastSeenAt)}</p>}
            </div>
            <div className="p-3 rounded-2xl bg-orange-50/40 border border-orange-100/40">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Punches (24 h)</p>
              <p className="mt-1 text-lg font-black text-slate-800">{status.punchesLast24h}</p>
            </div>
            <div className="p-3 rounded-2xl bg-orange-50/40 border border-orange-100/40">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Latest punch</p>
              <p className="mt-1 text-sm font-black text-slate-800">
                {status.latestPunch ? `${status.latestPunch.date} ${status.latestPunch.time.slice(0, 5)}` : '—'}
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-orange-50/40 border border-orange-100/40">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total stored</p>
              <p className="mt-1 text-lg font-black text-slate-800">{status.totalPunches}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500">
              Added a new employee? Set their <strong>Biometric ID</strong> on their profile, then press Link punches to build their past attendance.
            </p>
            <button
              type="button"
              onClick={handleReprocess}
              disabled={reprocessing}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#f46617] text-white text-xs font-bold hover:bg-[#d85512] disabled:opacity-60 transition-colors flex-shrink-0"
            >
              <Link2 className="w-3.5 h-3.5" />
              {reprocessing ? 'Linking…' : 'Link punches'}
            </button>
          </div>

          {status.officeIpConfigurable && (
            <div
              className={`mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl border ${
                device && !online ? 'bg-amber-50 border-amber-200' : 'border-slate-100'
              }`}
            >
              <p className="text-[11px] text-slate-600">
                {device && !online && (
                  <strong className="block text-amber-800">
                    Device offline? The office internet IP may have changed. Press the button from a computer at the office.
                  </strong>
                )}
                Allowed office network: <strong>{status.officeIp ?? 'not set'}</strong>. The device keeps its punches and sends them once it can connect.
              </p>
              <button
                type="button"
                onClick={handleAllowNetwork}
                disabled={allowing}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-[#f46617] text-[#f46617] text-xs font-bold hover:bg-orange-50 disabled:opacity-60 transition-colors flex-shrink-0"
              >
                <Wifi className="w-3.5 h-3.5" />
                {allowing ? 'Allowing…' : 'Allow this office network'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
