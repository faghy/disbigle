import { useTranslation } from 'react-i18next';
import { Card, cx, PageTitle } from '../../components/ui.tsx';
import {
  type Accent,
  accents,
  setAccent,
  setTheme,
  type Theme,
  themes,
  useAccent,
  useTheme,
} from '../../lib/theme.ts';

/** What each mode looks like, for the little previews: background, card, text. */
const MODE_LOOK: Record<Exclude<Theme, 'system'>, [string, string, string]> = {
  light: ['oklch(98.9% 0.003 80)', 'oklch(100% 0 0)', 'oklch(25% 0.012 50)'],
  dark: ['oklch(17% 0.006 60)', 'oklch(20.5% 0.007 60)', 'oklch(94% 0.006 80)'],
  black: ['oklch(0% 0 0)', 'oklch(17% 0 0)', 'oklch(94% 0 0)'],
};

/** The swatch of each accent (the light-mode tone). */
const ACCENT_HUE: Record<Accent, [number, number]> = {
  orange: [36, 1],
  red: [22, 1],
  pink: [350, 1],
  purple: [300, 1],
  blue: [255, 1],
  teal: [200, 1],
  green: [150, 1],
  grey: [260, 0],
};
const swatch = (accent: Accent) => {
  const [h, c] = ACCENT_HUE[accent];
  return `oklch(56% ${0.19 * c} ${h})`;
};

function ModePreview({ mode }: { mode: Theme }) {
  const look = (m: Exclude<Theme, 'system'>) => {
    const [bg, card, fg] = MODE_LOOK[m];
    return (
      <span className="flex h-full flex-1 flex-col gap-1 p-2" style={{ background: bg }}>
        <span className="h-2 w-2/3 rounded-full" style={{ background: fg, opacity: 0.8 }} />
        <span
          className="flex-1 rounded-md"
          style={{ background: card, border: `1px solid ${fg}22` }}
        />
        <span className="h-2 w-1/3 rounded-full bg-accent" />
      </span>
    );
  };
  return (
    <span className="flex h-20 overflow-hidden rounded-lg border border-border">
      {mode === 'system' ? (
        <>
          {look('light')}
          {look('dark')}
        </>
      ) : (
        look(mode)
      )}
    </span>
  );
}

/** Appearance: light, dark, black (OLED) or system, and the accent colour; kept on this device. */
export function AppearanceSettingsPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const accent = useAccent();
  return (
    <>
      <PageTitle description={t('appearance.description')}>{t('appearance.title')}</PageTitle>
      <div className="space-y-6">
        <Card>
          <fieldset>
            <legend className="font-semibold">{t('appearance.mode')}</legend>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {themes.map((value) => (
                <label
                  key={value}
                  className={cx(
                    'cursor-pointer space-y-2 rounded-xl border-2 p-2 has-focus-visible:ring-2 has-focus-visible:ring-accent',
                    theme === value ? 'border-accent' : 'border-transparent hover:border-border',
                  )}
                >
                  <input
                    type="radio"
                    name="mode"
                    value={value}
                    checked={theme === value}
                    onChange={() => setTheme(value)}
                    className="sr-only"
                  />
                  <ModePreview mode={value} />
                  <span className="block text-center text-sm font-medium">
                    {t(`theme.${value}`)}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-sm text-fg-muted">{t('appearance.blackHelp')}</p>
          </fieldset>
        </Card>
        <Card>
          <fieldset>
            <legend className="font-semibold">{t('appearance.color')}</legend>
            <div className="mt-3 flex flex-wrap gap-3">
              {accents.map((value) => (
                <label
                  key={value}
                  className={cx(
                    'flex cursor-pointer flex-col items-center gap-1.5 rounded-xl p-2 has-focus-visible:ring-2 has-focus-visible:ring-accent',
                    accent === value ? 'bg-surface-muted' : 'hover:bg-surface-muted',
                  )}
                >
                  <input
                    type="radio"
                    name="accent"
                    value={value}
                    checked={accent === value}
                    onChange={() => setAccent(value)}
                    className="sr-only"
                  />
                  <span
                    className={cx(
                      'size-10 rounded-full ring-offset-2 ring-offset-surface',
                      accent === value && 'ring-2 ring-fg',
                    )}
                    style={{ background: swatch(value) }}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-medium">{t(`appearance.colors.${value}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </Card>
      </div>
    </>
  );
}
