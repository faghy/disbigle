import { schema } from '@disbigle/db';
import type { InstanceSettings } from '@disbigle/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { CoreContext } from './context.ts';
import { logAdminAction } from './moderation.ts';

export type { InstanceSettings };

export const instanceSettingsPatchSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  registrationMode: z.enum(['open', 'approval', 'invite', 'closed']).optional(),
  rules: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
  contactEmail: z.union([z.email().max(320), z.literal('')]).optional(),
  welcomeAccount: z
    .string()
    .trim()
    .max(30)
    .regex(/^[A-Za-z0-9_]*$/)
    .optional(),
  welcomeAspect: z.string().trim().max(100).optional(),
  welcomeMessage: z.string().trim().max(5000).optional(),
});
export type InstanceSettingsPatch = z.infer<typeof instanceSettingsPatchSchema>;

/** Current settings: what the admins saved, falling back to the environment configuration. */
export async function getInstanceSettings(ctx: CoreContext): Promise<InstanceSettings> {
  const [row] = await ctx.db
    .select()
    .from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 'instance'));
  const data = row?.data ?? {};
  return {
    title: data.title ?? ctx.config.INSTANCE_TITLE,
    description: data.description ?? ctx.config.INSTANCE_DESCRIPTION,
    registrationMode: data.registrationMode ?? ctx.config.REGISTRATION_MODE,
    rules: data.rules ?? [],
    contactEmail: data.contactEmail ?? '',
    welcomeAccount: data.welcomeAccount ?? '',
    welcomeAspect: data.welcomeAspect ?? '',
    welcomeMessage: data.welcomeMessage ?? '',
  };
}

export async function updateInstanceSettings(
  ctx: CoreContext,
  adminUserId: string,
  patch: InstanceSettingsPatch,
): Promise<InstanceSettings> {
  const input = instanceSettingsPatchSchema.parse(patch);
  const [row] = await ctx.db
    .select()
    .from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 'instance'));
  const data = {
    ...(row?.data ?? {}),
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
  };
  await ctx.db
    .insert(schema.instanceSettings)
    .values({ id: 'instance', data })
    .onConflictDoUpdate({
      target: schema.instanceSettings.id,
      set: { data, updatedAt: new Date() },
    });
  await logAdminAction(
    ctx,
    adminUserId,
    'update_settings',
    { type: 'instance', id: 'instance' },
    input,
  );
  return getInstanceSettings(ctx);
}
