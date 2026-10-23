import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, Laptop, Loader2, Monitor, Package, Pencil, Plus, Smartphone, Tablet, Trash2, Undo2, X,
} from 'lucide-react';
import { assetApi, type AssetType, type EmployeeAsset, type EmployeeAssetInput } from '../../services/api';
import ConfirmDialog from '../ConfirmDialog';

interface AssetsTabProps {
  employeeId: number;
  employeeName: string;
  isHR: boolean;
  isOwnProfile: boolean;
}

const ASSET_TYPES: { value: AssetType; label: string; icon: React.ElementType }[] = [
  { value: 'LAPTOP', label: 'Laptop', icon: Laptop },
  { value: 'PHONE', label: 'Phone', icon: Smartphone },
  { value: 'TABLET', label: 'Tablet', icon: Tablet },
  { value: 'DESKTOP', label: 'Desktop', icon: Monitor },
  { value: 'OTHER', label: 'Other', icon: Package },
];
const typeInfo = (type: AssetType) => ASSET_TYPES.find(t => t.value === type) ?? ASSET_TYPES[ASSET_TYPES.length - 1];

const inputClass =
  'w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all';
const labelClass = 'block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5';
const smallButton =
  'inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-2xl border border-slate-200 transition-colors disabled:opacity-60';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const ymdOf = (iso: string) => iso.slice(0, 10);
const todayYmd = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const emptyForm = (): EmployeeAssetInput => ({ type: 'LAPTOP', name: '', serialNumber: '', assignedOn: todayYmd(), notes: '' });

/** Add / edit form, shown inline above the list (add) or in place of a card (edit). */
const AssetForm: React.FC<{
  initial: EmployeeAssetInput;
  submitLabel: string;
  onSubmit: (data: EmployeeAssetInput) => Promise<void>;
  onCancel: () => void;
}> = ({ initial, submitLabel, onSubmit, onCancel }) => {
  const [form, setForm] = useState<EmployeeAssetInput>(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof EmployeeAssetInput>(key: K, value: EmployeeAssetInput[K]) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-3xl p-4 sm:p-5 border border-orange-200 shadow-card space-y-4">
      <div>
        <p className={labelClass}>Type</p>
        <div className="flex flex-wrap gap-2">
          {ASSET_TYPES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => set('type', value)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
                form.type === value
                  ? 'bg-orange-50 border-[#f46617] text-[#c2410c]'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="asset-name">Make / model</label>
          <input
            id="asset-name"
            type="text"
            required
            maxLength={150}
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. Dell Latitude 5440"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="asset-serial">Serial number</label>
          <input
            id="asset-serial"
            type="text"
            maxLength={100}
            value={form.serialNumber ?? ''}
            onChange={e => set('serialNumber', e.target.value)}
            placeholder="e.g. 5CD1234XYZ"
            className={`${inputClass} font-mono`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="asset-assigned-on">Assigned on</label>
          <input
            id="asset-assigned-on"
            type="date"
            required
            value={form.assignedOn}
            onChange={e => set('assignedOn', e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="asset-notes">Notes</label>
          <input
            id="asset-notes"
            type="text"
            maxLength={2000}
            value={form.notes ?? ''}
            onChange={e => set('notes', e.target.value)}
            placeholder="IMEI, charger, accessories…"
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onCancel} className={`${smallButton} py-2.5`}>Cancel</button>
        <button
          type="submit"
          disabled={saving || !form.name.trim() || !form.assignedOn}
          className="btn-orange px-5 py-2.5 text-sm font-bold rounded-xl justify-center"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
};

export const AssetsTab: React.FC<AssetsTabProps> = ({ employeeId, employeeName, isHR, isOwnProfile }) => {
  const [assets, setAssets] = useState<EmployeeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [returning, setReturning] = useState<{ id: number; date: string; note: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EmployeeAsset | null>(null);

  const loadAssets = async () => {
    setError('');
    try {
      const res = await assetApi.listForEmployee(employeeId);
      setAssets(res.data?.assets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setAdding(false);
    setEditingId(null);
    setReturning(null);
    void loadAssets();
  }, [employeeId]);

  // Errors from the forms are shown in the banner; rethrown so the form stays open.
  const runAction = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      await loadAssets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      throw err;
    }
  };

  const handleCreate = (data: EmployeeAssetInput) =>
    runAction(() => assetApi.create(employeeId, data)).then(() => setAdding(false)).catch(() => undefined);

  const handleUpdate = (id: number, data: EmployeeAssetInput) =>
    runAction(() => assetApi.update(id, data)).then(() => setEditingId(null)).catch(() => undefined);

  const handleReturn = async () => {
    if (!returning) return;
    setBusyId(returning.id);
    try {
      await runAction(() => assetApi.markReturned(returning.id, { returnedOn: returning.date, notes: returning.note.trim() || undefined }));
      setReturning(null);
    } catch {
      // shown in the banner
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setBusyId(target.id);
    try {
      await runAction(() => assetApi.remove(target.id));
    } catch {
      // shown in the banner
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-[#f46617] animate-spin" />
      </div>
    );
  }

  const current = assets.filter(asset => !asset.returnedOn);
  const returned = assets.filter(asset => asset.returnedOn);

  const renderAsset = (asset: EmployeeAsset) => {
    if (editingId === asset.id) {
      return (
        <AssetForm
          key={asset.id}
          initial={{
            type: asset.type,
            name: asset.name,
            serialNumber: asset.serialNumber ?? '',
            assignedOn: ymdOf(asset.assignedOn),
            notes: asset.notes ?? '',
          }}
          submitLabel="Save changes"
          onSubmit={data => handleUpdate(asset.id, data)}
          onCancel={() => setEditingId(null)}
        />
      );
    }

    const { label, icon: Icon } = typeInfo(asset.type);
    const isReturned = Boolean(asset.returnedOn);
    const assignedByName = asset.assignedBy?.employee?.name ?? asset.assignedBy?.username;

    return (
      <div
        key={asset.id}
        className={`bg-white rounded-3xl p-4 border shadow-sm ${isReturned ? 'border-slate-100 opacity-75' : 'border-orange-100/50'}`}
      >
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${isReturned ? 'bg-slate-100 text-slate-400' : 'bg-orange-50 text-[#f46617]'}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black text-slate-800 break-words">
                {asset.name}
                <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
              </p>
              <p className="text-xs text-slate-600 font-semibold mt-1">
                S/N:{' '}
                {asset.serialNumber
                  ? <span className="font-mono select-all text-slate-800">{asset.serialNumber}</span>
                  : <span className="text-slate-400">not recorded</span>}
              </p>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">
                Assigned {fmt(asset.assignedOn)}
                {assignedByName ? ` · by ${assignedByName}` : ''}
                {asset.returnedOn ? ` · Returned ${fmt(asset.returnedOn)}` : ''}
              </p>
              {asset.notes && (
                <p className="text-xs text-slate-500 font-medium mt-2 whitespace-pre-line break-words">{asset.notes}</p>
              )}
            </div>
          </div>

          {isHR && (
            <div className="flex flex-wrap gap-2 md:flex-shrink-0">
              <button type="button" onClick={() => { setEditingId(asset.id); setReturning(null); }} className={smallButton}>
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
              {!isReturned && (
                <button
                  type="button"
                  onClick={() => setReturning({ id: asset.id, date: todayYmd(), note: '' })}
                  className={smallButton}
                >
                  <Undo2 className="w-3.5 h-3.5" /> Mark returned
                </button>
              )}
              <button
                type="button"
                onClick={() => setDeleteTarget(asset)}
                disabled={busyId === asset.id}
                className={`${smallButton} text-red-600 hover:bg-red-50 border-red-100`}
                aria-label={`Delete ${asset.name}`}
              >
                {busyId === asset.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
        </div>

        {returning?.id === asset.id && (
          <div className="mt-4 pt-4 border-t border-orange-100 flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="sm:w-44">
              <label className={labelClass} htmlFor={`return-date-${asset.id}`}>Returned on</label>
              <input
                id={`return-date-${asset.id}`}
                type="date"
                value={returning.date}
                min={ymdOf(asset.assignedOn)}
                onChange={e => setReturning({ ...returning, date: e.target.value })}
                className={inputClass}
              />
            </div>
            <div className="flex-1">
              <label className={labelClass} htmlFor={`return-note-${asset.id}`}>Condition / note</label>
              <input
                id={`return-note-${asset.id}`}
                type="text"
                maxLength={500}
                value={returning.note}
                onChange={e => setReturning({ ...returning, note: e.target.value })}
                placeholder="e.g. Good condition, charger returned"
                className={inputClass}
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setReturning(null)} className={`${smallButton} py-2.5`} aria-label="Cancel return">
                <X className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleReturn}
                disabled={busyId === asset.id || !returning.date}
                className="btn-orange px-4 py-2.5 text-sm font-bold rounded-xl justify-center flex-1 sm:flex-none"
              >
                {busyId === asset.id && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm return
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-800">Company Assets</h3>
          <p className="text-xs text-slate-500 font-semibold mt-1">
            {current.length} item{current.length === 1 ? '' : 's'} currently with {isOwnProfile ? 'you' : employeeName}
          </p>
        </div>
        {isHR && !adding && (
          <button
            type="button"
            onClick={() => { setAdding(true); setEditingId(null); }}
            className="btn-orange px-4 py-2.5 text-sm font-bold rounded-xl justify-center"
          >
            <Plus className="w-4 h-4" /> Assign asset
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 text-red-600 rounded-2xl p-3 text-xs font-semibold">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {adding && (
        <AssetForm initial={emptyForm()} submitLabel="Assign" onSubmit={handleCreate} onCancel={() => setAdding(false)} />
      )}

      {assets.length === 0 && !adding ? (
        <div className="text-center py-14 bg-white rounded-3xl border border-orange-100/50 shadow-card">
          <Laptop className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p className="font-bold text-slate-700">No company assets</p>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            {isHR ? 'Use "Assign asset" to record a laptop, phone or tablet.' : 'Assets HR assigns will show up here.'}
          </p>
        </div>
      ) : (
        <>
          {current.length > 0 && <div className="space-y-3">{current.map(renderAsset)}</div>}
          {returned.length > 0 && (
            <div className="space-y-3 pt-2">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Returned</p>
              {returned.map(renderAsset)}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete asset record?"
        message={`This removes "${deleteTarget?.name ?? ''}" from ${employeeName}'s history. To record that it came back, use "Mark returned" instead.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
