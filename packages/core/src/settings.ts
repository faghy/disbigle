import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { CoreContext } from './context.ts';
import { logAdminAction } from './moderation.ts';

export interface InstanceSettings {
  title: string;
  description: string;
  registrationMode: 'open' | 'approval' | 'invite' | 'closed';
  rules: string[];
  contactEmail: string;
}

export const instanceSettingsPatchSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  registrationMode: z.enum(['open', 'approval', 'invite', 'closed']).optional(),
  rules: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
  contactEmail: z.union([z.email().max(320), z.literal('')]).optional(),
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
