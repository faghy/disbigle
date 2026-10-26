/** Minimal server-rendered pages for the OAuth flow (the web team can restyle them later). */

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

type Lang = 'en' | 'it' | 'es';

const strings = {
  en: {
    authorize: 'Authorize',
    deny: 'Deny',
    wantsAccess: 'wants to use your account',
    signedInAs: 'Signed in as',
    permissions: 'This application will be able to:',
    error: 'Authorization error',
    codeTitle: 'Authorization code',
    codeHelp: 'Copy this code and paste it into the application:',
    notYou: 'Not you? Sign out and sign in with another account.',
  },
  it: {
    authorize: 'Autorizza',
    deny: 'Rifiuta',
    wantsAccess: 'vuole usare il tuo account',
    signedInAs: 'Accesso eseguito come',
    permissions: "L'applicazione potrà:",
    error: 'Errore di autorizzazione',
    codeTitle: 'Codice di autorizzazione',
    codeHelp: "Copia questo codice e incollalo nell'applicazione:",
    notYou: 'Non sei tu? Esci e accedi con un altro account.',
  },
  es: {
    authorize: 'Autorizar',
    deny: 'Rechazar',
    wantsAccess: 'quiere usar tu cuenta',
    signedInAs: 'Sesión iniciada como',
    permissions: 'Esta aplicación podrá:',
    error: 'Error de autorización',
    codeTitle: 'Código de autorización',
    codeHelp: 'Copia este código y pégalo en la aplicación:',
    notYou: '¿No eres tú? Cierra la sesión e inicia sesión con otra cuenta.',
  },
} as const;

const scopeLabels: Record<Lang, Record<string, string>> = {
  en: {
    read: 'read your account data, posts, notifications and lists',
    write: 'post, edit and delete posts, and change your profile',
    follow: 'follow, block and mute accounts',
    push: 'receive push notifications',
    profile: 'read your basic profile information',
  },
  it: {
    read: 'leggere i dati del tuo account, i post, le notifiche e le liste',
    write: 'pubblicare, modificare ed eliminare post, e cambiare il profilo',
    follow: 'seguire, bloccare e silenziare account',
    push: 'ricevere notifiche push',
    profile: 'leggere le informazioni di base del tuo profilo',
  },
  es: {
    read: 'leer los datos de tu cuenta, publicaciones, notificaciones y listas',
    write: 'publicar, editar y eliminar publicaciones, y cambiar tu perfil',
    follow: 'seguir, bloquear y silenciar cuentas',
    push: 'recibir notificaciones push',
    profile: 'leer la información básica de tu perfil',
  },
};

export function pickLang(...candidates: (string | undefined | null)[]): Lang {
  for (const c of candidates) {
    const base = c?.toLowerCase().slice(0, 2);
    if (base === 'it' || base === 'en' || base === 'es') return base;
  }
  return 'en';
}

function layout(lang: Lang, title: string, content: string): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="same-origin">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f4f4f7; color: #1d1d24; margin: 0; }
  main { max-width: 26rem; margin: 3rem auto; background: #fff; border-radius: 12px; padding: 1.5rem 1.75rem; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
  ul { padding-left: 1.2rem; }
  .muted { color: #6b6b78; font-size: .9rem; }
  .actions { display: flex; gap: .75rem; margin-top: 1.25rem; }
  button { flex: 1; font: inherit; padding: .65rem 1rem; border-radius: 8px; border: 1px solid #c9c9d3; background: #fff; cursor: pointer; }
  button.primary { background: #5b4bd6; border-color: #5b4bd6; color: #fff; }
  code { display: block; padding: .75rem; background: #f0f0f5; border-radius: 8px; word-break: break-all; font-size: 1rem; user-select: all; }
  @media (prefers-color-scheme: dark) {
    body { background: #16161c; color: #ececf1; }
    main { background: #22222b; box-shadow: none; }
    button { background: #2c2c36; color: #ececf1; border-color: #3a3a46; }
    code { background: #2c2c36; }
    .muted { color: #a0a0ad; }
  }
</style>
</head>
<body><main>${content}</main></body>
</html>`;
}

export interface ConsentPageInput {
  lang: Lang;
  appName: string;
  appWebsite: string | null;
  handle: string;
  scopes: string[];
  /** Hidden form fields posted back to `/oauth/authorize`. */
  fields: Record<string, string>;
}

export function consentPage(input: ConsentPageInput): string {
  const t = strings[input.lang];
  const labels = scopeLabels[input.lang];
  const families = [...new Set(input.scopes.map((s) => s.split(':')[0] ?? s))];
  const items = families
    .map((family) => {
      const detail = input.scopes
        .filter((s) => s.startsWith(`${family}:`))
        .map((s) => s.slice(family.length + 1));
      const label = labels[family] ?? family;
      return `<li>${escapeHtml(label)}${detail.length > 0 ? ` <span class="muted">(${escapeHtml(detail.join(', '))})</span>` : ''}</li>`;
    })
    .join('');
  const hidden = Object.entries(input.fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join('');
  const name = input.appWebsite
    ? `<a href="${escapeHtml(input.appWebsite)}" rel="noopener noreferrer" target="_blank">${escapeHtml(input.appName)}</a>`
    : escapeHtml(input.appName);
  return layout(
    input.lang,
    `${t.authorize} ${input.appName}`,
    `<h1>${name} ${escapeHtml(t.wantsAccess)}</h1>
<p class="muted">${escapeHtml(t.signedInAs)} <strong>@${escapeHtml(input.handle)}</strong></p>
<p>${escapeHtml(t.permissions)}</p>
<ul>${items}</ul>
<form method="post" action="/oauth/authorize">
${hidden}
<div class="actions">
<button type="submit" name="decision" value="deny">${escapeHtml(t.deny)}</button>
<button type="submit" name="decision" value="approve" class="primary">${escapeHtml(t.authorize)}</button>
</div>
</form>
<p class="muted">${escapeHtml(t.notYou)}</p>`,
  );
}

export function errorPage(lang: Lang, message: string): string {
  const t = strings[lang];
  return layout(lang, t.error, `<h1>${escapeHtml(t.error)}</h1><p>${escapeHtml(message)}</p>`);
}

export function codePage(lang: Lang, code: string): string {
  const t = strings[lang];
  return layout(
    lang,
    t.codeTitle,
    `<h1>${escapeHtml(t.codeTitle)}</h1><p>${escapeHtml(t.codeHelp)}</p><code>${escapeHtml(code)}</code>`,
  );
}

/** Restrictive CSP for these pages. No `form-action`: Chrome applies it to the redirect to the app. */
export const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; frame-ancestors 'none'; base-uri 'none'";
