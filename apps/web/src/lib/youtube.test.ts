import { describe, expect, it } from 'vitest';
import { firstYouTubeLink, youtubeEmbedUrl, youtubeLink } from './youtube.ts';

describe('YouTube links', () => {
  it('recognises the usual link shapes', () => {
    const id = 'LH_de3zZmkY';
    for (const href of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://m.youtube.com/watch?v=${id}&feature=share`,
      `https://youtu.be/${id}`,
      `https://youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}?si=abc`,
      `https://music.youtube.com/watch?v=${id}&list=x`,
    ]) {
      expect(youtubeLink(href), href).toEqual({ id, start: 0 });
    }
  });

  it('keeps the start time', () => {
    expect(youtubeLink('https://youtu.be/LH_de3zZmkY?t=90')?.start).toBe(90);
    expect(youtubeLink('https://www.youtube.com/watch?v=LH_de3zZmkY&t=1m30s')?.start).toBe(90);
  });

  it('ignores other sites and malformed ids', () => {
    expect(youtubeLink('https://www.youtube.com.evil.example/watch?v=LH_de3zZmkY')).toBeNull();
    expect(youtubeLink('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(youtubeLink('https://www.youtube.com/@channel')).toBeNull();
    expect(youtubeLink('javascript:alert(1)')).toBeNull();
  });

  it('finds the first video in a post, skipping hashtags', () => {
    const html =
      '<p><a class="hashtag" href="https://youtube.com/watch?v=AAAAAAAAAAA">#jazz</a> ' +
      '<a href="https://example.com">site</a> ' +
      '<a href="https://www.youtube.com/watch?v=LH_de3zZmkY">video</a></p>';
    expect(firstYouTubeLink(html)?.id).toBe('LH_de3zZmkY');
    expect(firstYouTubeLink('<p>no links</p>')).toBeNull();
  });

  it('plays from the no-cookie domain', () => {
    expect(youtubeEmbedUrl({ id: 'LH_de3zZmkY', start: 90 })).toBe(
      'https://www.youtube-nocookie.com/embed/LH_de3zZmkY?autoplay=1&rel=0&start=90',
    );
  });
});
