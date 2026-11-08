import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { social } from '../api/social.ts';
import { LinkCard } from './LinkCard.tsx';

/** YouTube links have their own player preview. */
const YOUTUBE = /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

/** The first web address typed in a post, as the server will pick it (not YouTube). */
export function firstLink(text: string): string | null {
  for (const match of text.matchAll(/https?:\/\/[^\s<>"]+/gi)) {
    const raw = match[0].replace(/[).,;:!?\]]+$/, '');
    try {
      const url = new URL(raw);
      if (YOUTUBE.test(url.hostname)) continue;
      url.hash = '';
      return url.href;
    } catch {}
  }
  return null;
}

/**
 * While writing: the preview of the first link, read by our server once typing pauses. The
 * same preview then goes with the post.
 */
export function ComposerLinkPreview({ text }: { text: string }) {
  const link = firstLink(text);
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(link), 700);
    return () => clearTimeout(timer);
  }, [link]);
  const preview = useQuery({
    queryKey: ['link-preview', settled],
    queryFn: () => social.linkPreview(settled as string),
    enabled: Boolean(settled),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const card = settled && settled === link ? preview.data?.card : null;
  if (!card) return null;
  return <LinkCard card={card} />;
}
