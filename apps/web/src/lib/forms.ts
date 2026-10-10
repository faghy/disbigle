import { type RefObject, useEffect } from 'react';

/** Moves focus to the first invalid control after a failed submit, so keyboard users land on it. */
export function useFocusFirstError(
  formRef: RefObject<HTMLFormElement | null>,
  errors: Record<string, string>,
) {
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    invalid?.focus();
  }, [errors, formRef]);
}

/** Triggers a download of a small text file built in the browser. */
export function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
