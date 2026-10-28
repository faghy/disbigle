import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { API_BASE, api } from '../api/client.ts';
import { type YouTubeLink, youtubeEmbedUrl } from '../lib/youtube.ts';
import { PlayIcon } from './icons.tsx';

interface YouTubeVideo {
  id: string;
  title: string;
  author: string;
}

/**
 * A YouTube video linked in a post. Title and thumbnail come through this server, so reading the
 * timeline tells YouTube nothing; the player loads from YouTube only when the reader presses play.
 */
export function YouTubePreview({ link }: { link: YouTubeLink }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const video = useQuery({
    queryKey: ['youtube', link.id],
    queryFn: () => api.get<YouTubeVideo>(`/youtube/${link.id}`),
    staleTime: 60 * 60_000,
    retry: false,
  });
  // Removed, private or unknown: the link in the text is enough.
  if (video.isError) return null;
  const title = video.data?.title || t('youtube.video');

  return (
    <figure className="mt-3 overflow-hidden rounded-xl border border-border bg-surface-muted">
      <div className="relative aspect-video bg-black">
        {playing ? (
          <iframe
            src={youtubeEmbedUrl(link)}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 size-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={t('youtube.play', { title })}
            className="group absolute inset-0 flex items-center justify-center focus-ring"
          >
            <img
              src={`${API_BASE}/youtube/${link.id}/thumbnail`}
              alt=""
              loading="lazy"
              className="absolute inset-0 size-full object-cover opacity-90 group-hover:opacity-100"
            />
            <span className="relative inline-flex h-12 w-16 items-center justify-center rounded-2xl bg-[#ff0033] text-white shadow-lg transition-transform group-hover:scale-110">
              <PlayIcon size={26} />
            </span>
          </button>
        )}
      </div>
      <figcaption className="flex flex-col gap-0.5 px-3 py-2">
        <span className="line-clamp-2 text-sm font-semibold">{title}</span>
        <span className="text-xs text-fg-muted">
          {video.data?.author ? `${video.data.author} · ` : ''}
          {playing ? t('youtube.playing') : t('youtube.privacy')}
        </span>
      </figcaption>
    </figure>
  );
}
