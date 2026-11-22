import type { PreviewCard } from '@disbigle/shared';

/**
 * Preview of the page a post links to. The image is stored on this server, so showing it
 * tells the linked site nothing; the page opens only when clicked. Always compact, a small
 * picture beside the text, so it does not look like a photo of the post (issue #32).
 */
export function LinkCard({ card }: { card: PreviewCard }) {
  return (
    <a
      href={card.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="mt-3 flex flex-row overflow-hidden rounded-xl border border-border bg-surface hover:bg-surface-muted focus-ring"
    >
      {card.image && (
        <img
          src={card.image}
          alt=""
          loading="lazy"
          className="size-24 shrink-0 self-center object-cover sm:size-28"
        />
      )}
      <span className="flex min-w-0 flex-col gap-0.5 px-3.5 py-2.5">
        <span className="truncate text-xs text-fg-muted">{card.siteName}</span>
        <span className="line-clamp-2 font-semibold">{card.title}</span>
        {card.description && (
          <span className="line-clamp-2 text-sm text-fg-muted">{card.description}</span>
        )}
      </span>
    </a>
  );
}
