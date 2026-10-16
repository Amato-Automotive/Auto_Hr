import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Sparkles, Trash2, Plus } from 'lucide-react';
import type { HeroBanner, UserRole } from '../services/api';
import { resolveAssetUrl } from '../utils/assetUrl';

interface HeroBannerCarouselProps {
  banners: HeroBanner[];
  role: UserRole;
  onAdd: () => void;
  onDelete: (id: number) => void;
}

const AUTO_ROTATE_MS = 7000;

function getYouTubeEmbedUrl(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  return match ? `https://www.youtube.com/embed/${match[1]}?autoplay=1&mute=1&loop=1&playlist=${match[1]}` : null;
}

function getVimeoEmbedUrl(url: string): string | null {
  const match = url.match(/vimeo\.com\/(\d+)/);
  return match ? `https://player.vimeo.com/video/${match[1]}?autoplay=1&muted=1&loop=1` : null;
}

const FALLBACK = <div className="w-full h-full bg-gradient-to-br from-orange-500 to-amber-500" />;

/** `failed` (image/video that couldn't load) renders the brand gradient instead of a grey broken box. */
const BannerMedia: React.FC<{ banner: HeroBanner; failed: boolean; onError: () => void }> = ({ banner, failed, onError }) => {
  if (failed) return FALLBACK;
  if (banner.mediaType === 'IMAGE' || banner.mediaType === 'GIF') {
    return <img src={resolveAssetUrl(banner.mediaUrl)} alt="" className="w-full h-full object-cover" onError={onError} />;
  }
  if (banner.mediaType === 'VIDEO_FILE') {
    return <video src={resolveAssetUrl(banner.mediaUrl)} className="w-full h-full object-cover" autoPlay muted loop playsInline onError={onError} />;
  }
  if (banner.mediaType === 'VIDEO_EMBED') {
    const embedUrl = getYouTubeEmbedUrl(banner.mediaUrl) || getVimeoEmbedUrl(banner.mediaUrl);
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
  return FALLBACK;
};

export const HeroBannerCarousel: React.FC<HeroBannerCarouselProps> = ({ banners, role, onAdd, onDelete }) => {
  const [failedIds, setFailedIds] = useState<Set<number>>(() => new Set());
  // A banner whose media won't load and has no text to show is just an empty box: hide it from
  // everyone except HR, who still needs to see it to remove it.
  const slides = useMemo(
    () => banners.filter(b => role === 'HR' || !failedIds.has(b.id) || b.title || b.subtitle),
    [banners, failedIds, role]
  );
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setInterval(() => setIndex(i => (i + 1) % slides.length), AUTO_ROTATE_MS);
    return () => clearInterval(timer);
  }, [slides.length]);

  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [slides.length, index]);

  if (slides.length === 0) {
    if (role !== 'HR') return null;
    return (
      <button
        onClick={onAdd}
        className="w-full rounded-[32px] border-2 border-dashed border-orange-200 bg-orange-50/30 hover:bg-orange-50/60 transition-all h-[160px] sm:h-[280px] flex flex-col items-center justify-center gap-2 text-slate-500"
      >
        <Plus className="w-8 h-8 text-[#f46617]" />
        <span className="text-sm font-bold">Add a hero banner</span>
        <span className="text-xs text-slate-400">Image, GIF, video, or a YouTube/Vimeo link</span>
      </button>
    );
  }

  const current = slides[index];
  const goTo = (next: number) => setIndex((next + slides.length) % slides.length);

  const Wrapper: React.ElementType = current.linkUrl ? 'a' : 'div';
  const wrapperProps = current.linkUrl ? { href: current.linkUrl, target: '_blank', rel: 'noopener noreferrer' } : {};

  return (
    <div className="relative w-full rounded-[32px] overflow-hidden shadow-card group h-[190px] sm:h-[380px] lg:h-[480px]">
      <Wrapper {...wrapperProps} className="absolute inset-0 block">
        <BannerMedia
          banner={current}
          failed={failedIds.has(current.id)}
          onError={() => setFailedIds(previous => new Set(previous).add(current.id))}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
      </Wrapper>

      {(current.title || current.subtitle) && (
        <div className="relative z-10 h-full flex flex-col justify-end p-6 sm:p-10 pointer-events-none">
          {current.title && (
            <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight leading-tight max-w-2xl drop-shadow-sm">
              {current.title}
            </h2>
          )}
          {current.subtitle && (
            <p className="text-sm sm:text-base text-white/85 mt-2 max-w-xl leading-relaxed">
              {current.subtitle}
            </p>
          )}
        </div>
      )}

      {role === 'HR' && (
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
          <button
            onClick={onAdd}
            className="w-8 h-8 rounded-full bg-white/15 backdrop-blur-md text-white flex items-center justify-center hover:bg-white/25"
            title="Add another banner"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(current.id)}
            className="w-8 h-8 rounded-full bg-white/15 backdrop-blur-md text-white flex items-center justify-center hover:bg-red-500/60"
            title="Remove this banner"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      <span className="absolute top-4 left-4 z-10 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/80 bg-black/20 backdrop-blur-sm px-2.5 py-1 rounded-full">
        <Sparkles className="w-3 h-3" /> Spotlight
      </span>

      {slides.length > 1 && (
        <>
          <button
            onClick={() => goTo(index - 1)}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/15 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/25"
            aria-label="Previous banner"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => goTo(index + 1)}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/15 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/25"
            aria-label="Next banner"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          <div className="absolute bottom-4 right-6 sm:right-10 z-20 flex items-center gap-2">
            {slides.map((s, i) => (
              <button
                key={s.id}
                onClick={() => goTo(i)}
                aria-label={`Go to banner ${i + 1}`}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/60'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
