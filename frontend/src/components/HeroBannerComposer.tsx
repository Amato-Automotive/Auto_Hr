import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Image as ImageIcon, Video, Link as LinkIcon, AlertTriangle, Loader2 } from 'lucide-react';
import { heroBannerApi, type HeroBanner } from '../services/api';

interface HeroBannerComposerProps {
  onClose: () => void;
  onCreated: (banner: HeroBanner) => void;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const HeroBannerComposer: React.FC<HeroBannerComposerProps> = ({ onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [mediaMode, setMediaMode] = useState<'FILE' | 'VIDEO_LINK'>('FILE');
  const [file, setFile] = useState<File | null>(null);
  const [videoLink, setVideoLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleFileSelected = (selected: FileList | null) => {
    if (!selected || !selected[0]) return;
    const picked = selected[0];
    if (picked.size > MAX_FILE_BYTES) {
      setError(`"${picked.name}" exceeds the 25MB limit`);
      return;
    }
    setError('');
    setFile(picked);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mediaMode === 'FILE' && !file) {
      setError('Choose an image, GIF, or video file to upload');
      return;
    }
    if (mediaMode === 'VIDEO_LINK') {
      try {
        new URL(videoLink);
      } catch {
        setError('Enter a valid YouTube or Vimeo link');
        return;
      }
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      if (title.trim()) formData.append('title', title.trim());
      if (subtitle.trim()) formData.append('subtitle', subtitle.trim());
      if (linkUrl.trim()) formData.append('linkUrl', linkUrl.trim());
      if (mediaMode === 'FILE' && file) formData.append('media', file);
      if (mediaMode === 'VIDEO_LINK') formData.append('videoLink', videoLink.trim());

      const res = await heroBannerApi.create(formData);
      if (res.data?.banner) {
        onCreated(res.data.banner);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to publish hero banner');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fade-in">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => { if (!submitting) onClose(); }} />

      <div className="relative bg-white rounded-[32px] border border-orange-100/50 shadow-2xl w-full max-w-xl overflow-hidden animate-scale-in max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-orange-100/50 flex-shrink-0">
          <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#f46617]" />
            New Hero Banner
          </h3>
          <button
            disabled={submitting}
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-orange-50 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="flex items-center gap-2 p-3.5 rounded-2xl bg-red-50 border border-red-100 text-red-600 text-sm font-semibold">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMediaMode('FILE')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                mediaMode === 'FILE' ? 'bg-[#f46617] text-white shadow-sm shadow-orange-500/30' : 'bg-orange-50/60 text-slate-500 hover:bg-orange-50'
              }`}
            >
              <ImageIcon className="w-4 h-4" /> Upload Image / GIF / Video
            </button>
            <button
              type="button"
              onClick={() => setMediaMode('VIDEO_LINK')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                mediaMode === 'VIDEO_LINK' ? 'bg-[#f46617] text-white shadow-sm shadow-orange-500/30' : 'bg-orange-50/60 text-slate-500 hover:bg-orange-50'
              }`}
            >
              <Video className="w-4 h-4" /> YouTube / Vimeo Link
            </button>
          </div>

          {mediaMode === 'FILE' ? (
            <label className="flex items-center justify-center gap-2 px-4 py-5 rounded-2xl border-2 border-dashed border-orange-200 bg-orange-50/30 text-slate-500 text-sm font-semibold cursor-pointer hover:bg-orange-50/60 transition-all">
              <ImageIcon className="w-4 h-4" />
              {file ? file.name : 'Click to upload image, GIF, or video'}
              <input
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={e => handleFileSelected(e.target.files)}
              />
            </label>
          ) : (
            <div className="relative">
              <LinkIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="url"
                value={videoLink}
                onChange={e => setVideoLink(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-orange-100 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Headline (optional)</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Welcome to Autoform Connect"
              className="w-full px-4 py-3 bg-white border border-orange-100 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Subtext (optional)</label>
            <textarea
              value={subtitle}
              onChange={e => setSubtitle(e.target.value)}
              placeholder="A short supporting line shown under the headline..."
              rows={2}
              className="w-full px-4 py-3 bg-white border border-orange-100 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Click-through Link (optional)</label>
            <input
              type="url"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-4 py-3 bg-white border border-orange-100 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 px-4 py-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 text-sm font-bold rounded-2xl transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 btn-orange px-4 py-3 text-sm font-bold rounded-2xl flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {submitting ? 'Publishing...' : 'Publish Banner'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
