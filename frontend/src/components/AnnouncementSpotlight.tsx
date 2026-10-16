import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Megaphone, ArrowRight } from 'lucide-react';
import type { Announcement, AnnouncementMedia } from '../services/api';

interface AnnouncementSpotlightProps {
  announcements: Announcement[];
  onViewAll: () => void;
  onOpenAnnouncement: (announcement: Announcement) => void;
}

function getYouTubeEmbedUrl(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

function getVimeoEmbedUrl(url: string): string | null {
  const match = url.match(/vimeo\.com\/(\d+)/);
  return match ? `https://player.vimeo.com/video/${match[1]}` : null;
}

const MediaFrame: React.FC<{ media: AnnouncementMedia | undefined }> = ({ media }) => {
  if (!media) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-orange-500 to-amber-500">
        <Megaphone className="w-16 h-16 text-white/30" />
      </div>
    );
  }

  if (media.type === 'IMAGE') {
    return <img src={media.url} alt="" className="w-full h-full object-cover" />;
  }

  if (media.type === 'VIDEO_FILE') {
    return <video src={media.url} controls className="w-full h-full object-cover" />;
  }

  if (media.type === 'VIDEO_EMBED') {
    const embedUrl = getYouTubeEmbedUrl(media.url) || getVimeoEmbedUrl(media.url);
    if (embedUrl) {
      return (
        <iframe
          src={embedUrl}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          frameBorder="0"
        />
      );
    }
  }

  if (media.type === 'SOCIAL_EMBED' || media.type === 'LINK') {
    return (
      <a
        href={media.url}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-700 to-slate-900 text-white"
      >
        <Megaphone className="w-10 h-10 opacity-60" />
        <span className="text-xs font-bold underline underline-offset-2 opacity-90">View Linked Post</span>
      </a>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-orange-500 to-amber-500">
      <Megaphone className="w-16 h-16 text-white/30" />
    </div>
  );
};

const PRIORITY_DOT: Record<Announcement['priority'], string> = {
  URGENT: 'bg-red-500 shadow-sm shadow-red-500/35',
  HIGH: 'bg-orange-500 shadow-sm shadow-orange-500/35',
  MEDIUM: 'bg-amber-500 shadow-sm shadow-amber-500/35',
  LOW: 'bg-slate-300',
};

export const AnnouncementSpotlight: React.FC<AnnouncementSpotlightProps> = ({ announcements, onViewAll, onOpenAnnouncement }) => {
  const slides = useMemo(
    () => [...announcements].sort((a, b) => Number(b.isPinned) - Number(a.isPinned)).slice(0, 8),
    [announcements]
  );

  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [slides.length, index]);

  if (slides.length === 0) return null;

  const current = slides[index];
  const primaryMedia = current.media?.[0];
  const goTo = (next: number) => setIndex((next + slides.length) % slides.length);

  return (
    <div className="bg-white rounded-[32px] p-4 sm:p-6 border border-orange-100/50 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-[#f46617]" />
          Company Announcements
        </h3>
        <button
          onClick={onViewAll}
          className="flex items-center gap-1 text-xs font-bold text-[#f46617] hover:text-orange-700 transition-colors"
        >
          View All <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Left: large media + detail — 70% */}
        <div
          onClick={() => onOpenAnnouncement(current)}
          className="lg:w-[70%] relative rounded-[24px] overflow-hidden group h-[300px] sm:h-[520px] flex-shrink-0 cursor-pointer"
        >
          <div className="absolute inset-0 bg-slate-100">
            <MediaFrame media={primaryMedia} />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent pointer-events-none" />

          <div className="relative z-10 h-full flex flex-col justify-end p-5 sm:p-8 pointer-events-none">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/80 mb-2">
              <span className={`inline-block w-2 h-2 rounded-full ${PRIORITY_DOT[current.priority]}`} />
              {current.isPinned ? 'Pinned' : 'Announcement'}
            </span>
            <h2 className="text-xl sm:text-3xl font-black text-white tracking-tight leading-tight max-w-2xl drop-shadow-sm">
              {current.title}
            </h2>
            {current.content && (
              <p className="text-sm text-white/85 mt-2 max-w-xl leading-relaxed line-clamp-2">
                {current.content}
              </p>
            )}
          </div>

          {slides.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); goTo(index - 1); }}
                className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/15 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/25"
                aria-label="Previous announcement"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); goTo(index + 1); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/15 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/25"
                aria-label="Next announcement"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>

        {/* Right: latest highlights list — 30% */}
        <div className="lg:w-[30%] flex flex-col gap-2.5 overflow-y-auto max-h-[520px] pr-1">
          {slides.map((ann, i) => (
            <button
              key={ann.id}
              onClick={() => { goTo(i); onOpenAnnouncement(ann); }}
              className={`flex items-start gap-3 p-3.5 rounded-2xl text-left border transition-all duration-200 ${
                i === index
                  ? 'bg-orange-50/70 border-orange-200'
                  : 'bg-orange-50/15 hover:bg-orange-50/45 border-orange-100/30'
              }`}
            >
              <span className={`inline-block w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${PRIORITY_DOT[ann.priority]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800 leading-snug line-clamp-2">{ann.title}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1.5">
                  {new Date(ann.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  {!ann.isRead && <span className="ml-2 text-[#f46617]">• New</span>}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
