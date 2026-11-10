/**
 * What the Digital Services Act (Reg. EU 2022/2065) asks of a hosting service, small ones too:
 * - notices from anyone, with or without an account here (art. 16), and from other servers;
 * - a decision on each notice, told to whoever sent it (art. 16.5);
 * - a statement of reasons to the person whose content was removed or whose account was
 *   suspended, with the ground and how to contest it (art. 17).
 * Every decision is also kept in the moderation log, with its reason.
 */
import { isLocalDomain } from '@disbigle/config';
import { schema, uuidv7 } from '@disbigle/db';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { CoreContext } from './context.ts';
import { DomainError } from './errors.ts';
import type { Mailer } from './mail.ts';
import { logAdminAction, type ReportCategory, suspendAccount } from './moderation.ts';
import { deletePost } from './social/posts.ts';

const { reports, posts, actors, users } = schema;

export type ModerationDecision = 'removed' | 'suspended' | 'no_violation';
/** Why: against the law, or against the server rules (terms of service). */
export type ModerationGround = 'illegal' | 'rules';

type Locale = 'it' | 'en' | 'es';
const locale = (value: string | null | undefined): Locale =>
  value === 'it' || value === 'es' ? value : 'en';

const CONTACT = 'disbin@disbigle.com';

const texts = {
  it: {
    removedSubject: 'Un tuo contenuto è stato rimosso',
    suspendedSubject: 'Il tuo account è stato sospeso',
    removed: (domain: string) => `La moderazione di ${domain} ha rimosso questo tuo contenuto:`,
    suspended: (domain: string) => `La moderazione di ${domain} ha sospeso il tuo account.`,
    ground: { illegal: 'contenuto illegale', rules: 'contrario alle regole del server' },
    groundLabel: 'Motivo',
    reasonLabel: 'Spiegazione',
    noReason: '(nessuna spiegazione aggiuntiva)',
    how: 'La decisione è stata presa da una persona della moderazione, a seguito di una segnalazione o di una verifica, senza sistemi automatici.',
    appeal: (rules: string, terms: string) =>
      `Se pensi che sia un errore puoi contestare la decisione entro 6 mesi rispondendo a questa email o scrivendo a ${CONTACT}: la rivedremo. Puoi anche rivolgerti a un organismo di risoluzione extragiudiziale o all'autorità giudiziaria.\n\nRegole: ${rules}\nCondizioni d'uso: ${terms}`,
    noticeSubject: 'Esito della tua segnalazione',
    notice: (domain: string) =>
      `Grazie per la segnalazione a ${domain}. La moderazione l'ha esaminata e ha deciso:`,
    decisions: {
      removed: 'il contenuto è stato rimosso.',
      suspended: "l'account segnalato è stato sospeso.",
      no_violation:
        'non abbiamo trovato violazioni della legge o delle regole: il contenuto resta.',
    },
    noticeAppeal: `Se non sei d'accordo puoi scriverci a ${CONTACT}.`,
    receivedSubject: 'Abbiamo ricevuto la tua segnalazione',
    received: (domain: string, url: string) =>
      `Abbiamo ricevuto la tua segnalazione su ${domain} riguardo a:\n${url}\n\nLa esamineremo il prima possibile, di solito entro 24-48 ore, e ti scriveremo l'esito.`,
  },
  en: {
    removedSubject: 'Some of your content was removed',
    suspendedSubject: 'Your account was suspended',
    removed: (domain: string) => `The moderators of ${domain} removed this content of yours:`,
    suspended: (domain: string) => `The moderators of ${domain} suspended your account.`,
    ground: { illegal: 'illegal content', rules: 'against the server rules' },
    groundLabel: 'Ground',
    reasonLabel: 'Explanation',
    noReason: '(no further explanation)',
    how: 'The decision was taken by a person on the moderation team, after a report or a check, without automated means.',
    appeal: (rules: string, terms: string) =>
      `If you think this is a mistake you can contest the decision within 6 months by replying to this email or writing to ${CONTACT}: we will review it. You can also turn to an out-of-court dispute settlement body or to the courts.\n\nRules: ${rules}\nTerms of service: ${terms}`,
    noticeSubject: 'Outcome of your report',
    notice: (domain: string) =>
      `Thank you for your report to ${domain}. The moderators looked at it and decided:`,
    decisions: {
      removed: 'the content was removed.',
      suspended: 'the reported account was suspended.',
      no_violation: 'we found no breach of the law or of the rules: the content stays.',
    },
    noticeAppeal: `If you disagree you can write to us at ${CONTACT}.`,
    receivedSubject: 'We received your report',
    received: (domain: string, url: string) =>
      `We received your report to ${domain} about:\n${url}\n\nWe will look at it as soon as we can, usually within 24-48 hours, and write to you with the outcome.`,
  },
  es: {
    removedSubject: 'Se ha retirado un contenido tuyo',
    suspendedSubject: 'Se ha suspendido tu cuenta',
    removed: (domain: string) => `La moderación de ${domain} ha retirado este contenido tuyo:`,
    suspended: (domain: string) => `La moderación de ${domain} ha suspendido tu cuenta.`,
    ground: { illegal: 'contenido ilegal', rules: 'contrario a las normas del servidor' },
    groundLabel: 'Motivo',
    reasonLabel: 'Explicación',
    noReason: '(sin más explicaciones)',
    how: 'La decisión la tomó una persona del equipo de moderación, tras una denuncia o una revisión, sin medios automatizados.',
    appeal: (rules: string, terms: string) =>
      `Si crees que es un error puedes impugnar la decisión en un plazo de 6 meses respondiendo a este correo o escribiendo a ${CONTACT}: la revisaremos. También puedes acudir a un órgano de resolución extrajudicial o a los tribunales.\n\nNormas: ${rules}\nCondiciones de uso: ${terms}`,
    noticeSubject: 'Resultado de tu denuncia',
    notice: (domain: string) =>
      `Gracias por tu denuncia a ${domain}. La moderación la ha examinado y ha decidido:`,
    decisions: {
      removed: 'el contenido se ha retirado.',
      suspended: 'la cuenta denunciada se ha suspendido.',
      no_violation:
        'no hemos encontrado infracciones de la ley ni de las normas: el contenido se queda.',
    },
    noticeAppeal: `Si no estás de acuerdo puedes escribirnos a ${CONTACT}.`,
    receivedSubject: 'Hemos recibido tu denuncia',
    received: (domain: string, url: string) =>
      `Hemos recibido tu denuncia a ${domain} sobre:\n${url}\n\nLa revisaremos lo antes posible, normalmente en 24-48 horas, y te escribiremos con el resultado.`,
  },
} as const;

const pages = {
  it: { rules: 'https://disbigle.com/it/regole', terms: 'https://disbigle.com/it/termini' },
  en: { rules: 'https://disbigle.com/rules', terms: 'https://disbigle.com/terms' },
  es: { rules: 'https://disbigle.com/es/normas', terms: 'https://disbigle.com/es/terminos' },
} as const;

const plain = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

/** The local user behind an account, if any (remote authors hear from their own server). */
async function localUserOf(ctx: CoreContext, actorId: string) {
  const [user] = await ctx.db.select().from(users).where(eq(users.actorId, actorId));
  return user ?? null;
}

/** Statement of reasons (DSA art. 17) to a local user, by email. */
export async function sendStatementOfReasons(
  ctx: CoreContext & { mailer?: Mailer | undefined },
  actorId: string,
  input: {
    action: 'removed' | 'suspended';
    ground: ModerationGround;
    reason: string;
    /** The removed content, quoted in the message. */
    excerpt?: string | undefined;
  },
): Promise<boolean> {
  if (!ctx.mailer) return false;
  const user = await localUserOf(ctx, actorId);
  if (!user) return false;
  const lang = locale(user.locale);
  const t = texts[lang];
  const domain = ctx.config.LOCAL_DOMAIN;
  const lines = [
    input.action === 'removed' ? t.removed(domain) : t.suspended(domain),
    '',
    ...(input.excerpt ? [`«${input.excerpt.slice(0, 500)}»`, ''] : []),
    `${t.groundLabel}: ${t.ground[input.ground]}`,
    `${t.reasonLabel}: ${input.reason.trim() || t.noReason}`,
    '',
    t.how,
    '',
    t.appeal(pages[lang].rules, pages[lang].terms),
  ];
  await ctx.mailer.send({
    to: user.email,
    subject: input.action === 'removed' ? t.removedSubject : t.suspendedSubject,
    text: lines.join('\n'),
  });
  return true;
}

/**
 * Removes a post as a moderator, with its ground and reason; the author (when local) gets the
 * statement of reasons. Federated like any deletion.
 */
export async function removePostAsModerator(
  ctx: CoreContext & { mailer?: Mailer | undefined },
  moderatorUserId: string,
  postId: string,
  input: { ground: ModerationGround; reason: string; reportId?: string | undefined },
): Promise<void> {
  const [post] = await ctx.db.select().from(posts).where(eq(posts.id, postId));
  if (!post) throw new DomainError('not_found', 'Post not found');
  const [moderator] = await ctx.db.select().from(users).where(eq(users.id, moderatorUserId));
  if (!moderator) throw new DomainError('forbidden', 'Moderators only');
  await deletePost(ctx, moderator.actorId, post.id, { asModerator: true });
  const excerpt = plain(post.contentHtml).slice(0, 500);
  await logAdminAction(
    ctx,
    moderatorUserId,
    'remove_post',
    { type: 'post', id: post.id },
    {
      authorActorId: post.actorId,
      ground: input.ground,
      reason: input.reason,
      excerpt,
      ...(input.reportId ? { reportId: input.reportId } : {}),
    },
  );
  await sendStatementOfReasons(ctx, post.actorId, {
    action: 'removed',
    ground: input.ground,
    reason: input.reason,
    excerpt,
  }).catch(() => false);
}

/** Suspends an account and tells its owner why (DSA art. 17). */
export async function suspendAccountWithReasons(
  ctx: CoreContext & { mailer?: Mailer | undefined },
  moderatorUserId: string,
  actorId: string,
  input: { ground: ModerationGround; reason: string },
): Promise<void> {
  await suspendAccount(ctx, moderatorUserId, actorId, input.reason, input.ground);
  await sendStatementOfReasons(ctx, actorId, {
    action: 'suspended',
    ground: input.ground,
    reason: input.reason,
  }).catch(() => false);
}

/**
 * Closes a report with its decision and reason, and tells whoever sent it (a local account by
 * email, or the email left on the public form). Remote reporters are not written to.
 */
export async function decideReport(
  ctx: CoreContext & { mailer?: Mailer | undefined },
  moderatorUserId: string,
  reportId: string,
  input: { decision: ModerationDecision; reason: string },
): Promise<void> {
  const [report] = await ctx.db
    .update(reports)
    .set({
      resolvedAt: new Date(),
      resolvedById: moderatorUserId,
      decision: input.decision,
      decisionReason: input.reason.slice(0, 2000),
    })
    .where(and(eq(reports.id, reportId), isNull(reports.resolvedAt)))
    .returning();
  if (!report) throw new DomainError('not_found', 'Open report not found');
  await logAdminAction(
    ctx,
    moderatorUserId,
    'resolve_report',
    { type: 'report', id: reportId },
    { decision: input.decision, reason: input.reason },
  );
  if (!ctx.mailer) return;
  let to: string | null = null;
  let lang: Locale = 'en';
  if (report.reporterActorId) {
    const user = await localUserOf(ctx, report.reporterActorId);
    if (user) {
      to = user.email;
      lang = locale(user.locale);
    }
  } else if (report.notifierEmail) {
    to = report.notifierEmail;
    lang = locale(report.notifierLocale);
  }
  if (!to) return;
  const t = texts[lang];
  await ctx.mailer
    .send({
      to,
      subject: t.noticeSubject,
      text: [
        t.notice(ctx.config.LOCAL_DOMAIN),
        '',
        ...(report.contentUrl ? [report.contentUrl, ''] : []),
        t.decisions[input.decision],
        ...(input.reason.trim() ? ['', input.reason.trim()] : []),
        '',
        t.noticeAppeal,
      ].join('\n'),
    })
    .catch(() => undefined);
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * The post or account an address on this server points to: a post page (`/@user/<id>`), a
 * post's ActivityPub address, or a profile (`/@user`, `/@user@server`, `/users/user`).
 */
export async function findContentByUrl(
  ctx: CoreContext,
  address: string,
): Promise<{ actorId: string; postId: string | null } | null> {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  const clean = `${url.origin}${url.pathname}`.replace(/\/$/, '');
  const [byUri] = await ctx.db
    .select({ id: posts.id, actorId: posts.actorId })
    .from(posts)
    .where(or(eq(posts.apUri, clean), eq(posts.apUrl, clean)));
  if (byUri) return { actorId: byUri.actorId, postId: byUri.id };
  const id = UUID.exec(url.pathname)?.[0]?.toLowerCase();
  if (id) {
    const [post] = await ctx.db
      .select({ id: posts.id, actorId: posts.actorId })
      .from(posts)
      .where(eq(posts.id, id));
    if (post) return { actorId: post.actorId, postId: post.id };
  }
  const handle =
    /^\/@([^/]+)/.exec(decodeURIComponent(url.pathname))?.[1] ??
    /^\/users\/([^/]+)/.exec(url.pathname)?.[1];
  if (!handle) return null;
  const [username = '', domain = null] = handle.split('@');
  const [actor] = await ctx.db
    .select({ id: actors.id })
    .from(actors)
    .where(
      and(
        sql`lower(${actors.username}) = lower(${username})`,
        domain && !isLocalDomain(ctx.config, domain)
          ? sql`lower(${actors.domain}) = lower(${domain})`
          : isNull(actors.domain),
      ),
    );
  return actor ? { actorId: actor.id, postId: null } : null;
}

export interface PublicNotice {
  url: string;
  category: ReportCategory;
  explanation: string;
  name?: string | undefined;
  email?: string | undefined;
  locale?: string | undefined;
}

/**
 * A notice of illegal content sent by anyone through the public form (DSA art. 16). The address
 * must point to content on this server. A confirmation goes to the email left, if any.
 */
export async function createPublicNotice(
  ctx: CoreContext & { mailer?: Mailer | undefined },
  input: PublicNotice,
): Promise<{ id: string }> {
  const found = await findContentByUrl(ctx, input.url);
  if (!found)
    throw new DomainError('not_found', 'No post or account at this address on this server');
  const id = uuidv7();
  const email = input.email?.trim() || null;
  await ctx.db.insert(reports).values({
    id,
    reporterActorId: null,
    targetActorId: found.actorId,
    postIds: found.postId ? [found.postId] : [],
    category: input.category,
    comment: input.explanation.slice(0, 4000),
    source: 'public',
    notifierName: input.name?.trim().slice(0, 200) || null,
    notifierEmail: email,
    notifierLocale: locale(input.locale),
    contentUrl: input.url.trim().slice(0, 2000),
  });
  if (email && ctx.mailer) {
    const t = texts[locale(input.locale)];
    await ctx.mailer
      .send({
        to: email,
        subject: t.receivedSubject,
        text: t.received(ctx.config.LOCAL_DOMAIN, input.url.trim()),
      })
      .catch(() => undefined);
  }
  return { id };
}

/**
 * A report sent by another server (ActivityPub `Flag`) about accounts and posts here. Kept like
 * the others, marked as coming from that server.
 */
export async function createRemoteReport(
  ctx: CoreContext,
  input: {
    reporterActorId: string;
    targetActorId: string;
    postIds: string[];
    comment: string;
  },
): Promise<{ id: string }> {
  const id = uuidv7();
  await ctx.db.insert(reports).values({
    id,
    reporterActorId: input.reporterActorId,
    targetActorId: input.targetActorId,
    postIds: [...new Set(input.postIds)].slice(0, 20),
    category: 'other',
    comment: input.comment.slice(0, 4000),
    source: 'remote',
  });
  return { id };
}

/** Reports and moderation decisions are kept this long (privacy policy), then deleted. */
export const MODERATION_RETENTION_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/** Deletes reports closed, and moderation log entries made, more than two years ago. */
export async function purgeOldModerationRecords(ctx: CoreContext): Promise<number> {
  const before = new Date(Date.now() - MODERATION_RETENTION_MS);
  const oldReports = await ctx.db
    .delete(reports)
    .where(lt(reports.resolvedAt, before))
    .returning({ id: reports.id });
  const oldLogs = await ctx.db
    .delete(schema.adminActionLogs)
    .where(lt(schema.adminActionLogs.createdAt, before))
    .returning({ id: schema.adminActionLogs.id });
  return oldReports.length + oldLogs.length;
}
