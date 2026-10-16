import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle,
  Download,
  Eye,
  FileText,
  Loader2,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { libraryApi, type LibraryDocument, type UserRole } from '../../services/api';
import { LibraryDocumentViewer } from '../LibraryDocumentViewer';
import { useAuth } from '../../context/AuthContext';

const MANAGEMENT_ROLES: UserRole[] = ['HR', 'LEADERSHIP', 'MANAGER'];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function saveDownloadedFile(payload: { fileName: string; mimeType: string; contentUrl: string }) {
  const link = document.createElement('a');
  link.href = payload.contentUrl;
  link.download = payload.fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

interface ELibraryTabProps {
  role: UserRole;
}

export const ELibraryTab: React.FC<ELibraryTabProps> = ({ role }) => {
  const { user } = useAuth();
  const canManage = MANAGEMENT_ROLES.includes(role);
  // HR can remove anything; managers/leadership only what they uploaded (the API enforces this too).
  const canDelete = (document: LibraryDocument) => role === 'HR' || (canManage && document.uploadedById === user?.id);
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [viewingDocument, setViewingDocument] = useState<LibraryDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = () => {
    setLoading(true);
    libraryApi.list()
      .then(res => { if (res.data) setDocuments(res.data.documents); })
      .catch(err => setError(err.message || 'Failed to load the library'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!file) {
      setError('Choose a PDF or Word document');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await libraryApi.upload(title.trim(), description.trim(), file);
      setTitle('');
      setDescription('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to upload document');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkRead = async (id: number) => {
    setDocuments(prev => prev.map(d => (d.id === id && !d.isRead ? { ...d, isRead: true, readCount: d.readCount + 1 } : d)));
    try {
      await libraryApi.markRead(id);
    } catch (err: any) {
      setError(err.message || 'Failed to mark as read');
    }
  };

  const handleMarkReadManually = async (id: number) => {
    setBusyId(id);
    await handleMarkRead(id);
    setBusyId(null);
  };

  const handleDownload = async (id: number) => {
    setBusyId(id);
    setError('');
    try {
      const res = await libraryApi.download(id);
      if (res.data) saveDownloadedFile(res.data);
    } catch (err: any) {
      setError(err.message || 'Failed to download document');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (document: LibraryDocument) => {
    if (!window.confirm(`Remove "${document.title}" from the library?`)) return;
    setError('');
    try {
      await libraryApi.remove(document.id);
      setDocuments(prev => prev.filter(d => d.id !== document.id));
    } catch (err: any) {
      setError(err.message || 'Failed to remove document');
    }
  };

  const filtered = documents.filter(d => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [d.title, d.description, d.fileName].filter(Boolean).join(' ').toLowerCase().includes(term);
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">E-Library</h2>
        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-0.5">
          Shared PDFs and documents for everyone to read and download
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 text-red-600 rounded-2xl p-3 text-xs font-semibold">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      <div className={canManage ? 'grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6' : 'space-y-4'}>
        {canManage && (
          <form onSubmit={handleUpload} className="bg-white rounded-3xl border border-orange-100/50 shadow-card p-5 h-fit space-y-4">
            <h3 className="text-sm font-black text-slate-800">Add Document</h3>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Title</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Leave Policy 2026"
                className="w-full px-3.5 py-2.5 bg-white border border-orange-100 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Description (optional)</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder="What is this document about?"
                className="w-full px-3.5 py-2.5 bg-white border border-orange-100 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange resize-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">File</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs text-slate-500 file:mr-3 file:rounded-xl file:border-0 file:bg-orange-50 file:px-3 file:py-2 file:text-xs file:font-bold file:text-[#f46617] hover:file:bg-orange-100"
              />
              <p className="text-[10px] text-slate-400 font-semibold mt-2">PDF or Word document, up to 25MB.</p>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="btn-orange w-full py-2.5 text-sm font-bold rounded-2xl disabled:opacity-60"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {submitting ? 'Uploading...' : 'Upload Document'}
            </button>
          </form>
        )}

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by title or description..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-orange-100 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange shadow-sm"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-[#f46617] animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-400 bg-white rounded-3xl border border-orange-100/50 shadow-card">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50 text-slate-400" />
              <p className="font-semibold">{documents.length === 0 ? 'No documents yet' : 'No documents match your search'}</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map(document => (
                <div
                  key={document.id}
                  className="bg-white rounded-[24px] border border-orange-100/50 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col"
                >
                  <button
                    type="button"
                    onClick={() => setViewingDocument(document)}
                    className="h-28 bg-gradient-to-br from-orange-100 to-amber-50 flex items-center justify-center overflow-hidden group relative"
                  >
                    <FileText className="w-10 h-10 text-orange-300" />
                    <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/30 transition-colors flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-bold flex items-center gap-1.5">
                        <Eye className="w-3.5 h-3.5" /> Open
                      </span>
                    </div>
                  </button>

                  <div className="p-4 flex-1 flex flex-col">
                    <div className="flex items-center gap-2 mb-2">
                      {document.isRead && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
                          <CheckCircle className="w-2.5 h-2.5" /> Read
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-slate-800 leading-snug mb-1 truncate">{document.title}</h3>
                    {document.description && (
                      <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-3">{document.description}</p>
                    )}
                    <p className="text-[11px] text-slate-400 font-semibold mb-3">
                      {document.fileName} · {formatBytes(document.sizeBytes)}
                      {document.uploadedBy && ` · ${document.uploadedBy.username}`}
                    </p>

                    <div className="mt-auto space-y-2">
                      <button
                        type="button"
                        onClick={() => setViewingDocument(document)}
                        className="btn-orange px-3 py-2 text-xs font-bold rounded-xl w-full justify-center flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" /> Open
                      </button>
                      <div className="flex gap-2">
                        {!document.isRead && (
                          <button
                            type="button"
                            onClick={() => handleMarkReadManually(document.id)}
                            disabled={busyId === document.id}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-orange-50 hover:bg-orange-100 text-[#f46617] border border-orange-100 transition-colors disabled:opacity-60"
                          >
                            {busyId === document.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                            Mark Read
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDownload(document.id)}
                          disabled={busyId === document.id}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 transition-colors disabled:opacity-60"
                          title="Download"
                        >
                          {busyId === document.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                          Download
                        </button>
                        {canDelete(document) && (
                          <button
                            type="button"
                            onClick={() => handleDelete(document)}
                            className="inline-flex items-center justify-center p-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl border border-red-100 transition-colors flex-shrink-0"
                            title="Remove document"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {viewingDocument && (
        <LibraryDocumentViewer
          document={viewingDocument}
          onClose={() => setViewingDocument(null)}
          onOpened={() => handleMarkRead(viewingDocument.id)}
        />
      )}
    </div>
  );
};
