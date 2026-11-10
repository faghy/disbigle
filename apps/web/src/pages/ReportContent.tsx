import { useMutation } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.ts';
import { errorMessage } from '../api/errors.ts';
import {
  Alert,
  Button,
  Card,
  CheckboxField,
  PageTitle,
  TextAreaField,
  TextField,
} from '../components/ui.tsx';

const categories = ['illegal', 'harassment', 'spam', 'violation', 'other'] as const;
type Category = (typeof categories)[number];

/**
 * Notice of illegal content for anyone, with or without an account (DSA art. 16): the address
 * of the content, why it is illegal, who sends it (optional) and a statement of good faith.
 */
export function ReportContentPage() {
  const { t, i18n } = useTranslation();
  const search = useSearch({ from: '/report-content' });
  const [url, setUrl] = useState(search.url ?? '');
  const [category, setCategory] = useState<Category>('illegal');
  const [explanation, setExplanation] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [goodFaith, setGoodFaith] = useState(false);
  const send = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/notices', {
        url: url.trim(),
        category,
        explanation: explanation.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        locale: i18n.language,
        goodFaith,
      }),
  });

  if (send.isSuccess)
    return (
      <Card>
        <div role="status">
          <h1 className="text-2xl font-semibold tracking-tight">{t('notice.doneTitle')}</h1>
          <p className="mt-2 text-fg-muted">
            {email.trim() ? t('notice.doneEmail') : t('notice.done')}
          </p>
        </div>
      </Card>
    );

  return (
    <div>
      <PageTitle description={t('notice.description')}>{t('notice.title')}</PageTitle>
      <Card>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            send.mutate();
          }}
        >
          <TextField
            label={t('notice.url')}
            hint={t('notice.urlHint')}
            type="url"
            required
            maxLength={2000}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('report.categoryLegend')}</legend>
            {categories.map((value) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="category"
                  className="mt-1"
                  checked={category === value}
                  onChange={() => setCategory(value)}
                />
                <span>
                  <span className="font-medium">{t(`report.categories.${value}.label`)}</span>
                  <span className="block text-fg-muted">
                    {t(`report.categories.${value}.description`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <TextAreaField
            label={t('notice.explanation')}
            hint={t('notice.explanationHint')}
            required
            minLength={10}
            maxLength={4000}
            rows={5}
            value={explanation}
            onChange={(event) => setExplanation(event.target.value)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('notice.name')}
              maxLength={200}
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              label={t('notice.email')}
              type="email"
              maxLength={320}
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <p className="text-xs text-fg-muted">{t('notice.contactHint')}</p>
          <CheckboxField
            label={t('notice.goodFaith')}
            required
            checked={goodFaith}
            onChange={(event) => setGoodFaith(event.target.checked)}
          />
          <Alert>{send.error ? errorMessage(send.error) : null}</Alert>
          <Button type="submit" loading={send.isPending}>
            {t('notice.submit')}
          </Button>
          <p className="text-xs text-fg-muted">{t('notice.childAbuse')}</p>
        </form>
      </Card>
    </div>
  );
}
