/** Something that happened in the domain, for streaming, federation and background work. */
export type DomainEvent =
  | { type: 'post.created'; postId: string; actorId: string }
  | { type: 'post.deleted'; postId: string; actorId: string; apUri: string | null }
  | { type: 'notification.created'; notificationId: string; recipientActorId: string }
  | { type: 'follow.created'; followId: string; actorId: string; targetActorId: string }
  | { type: 'follow.requested'; actorId: string; targetActorId: string }
  | { type: 'follow.removed'; actorId: string; targetActorId: string }
  | { type: 'like.created'; likeId: string; actorId: string; postId: string }
  | { type: 'like.removed'; actorId: string; postId: string }
  | { type: 'profile.updated'; actorId: string };

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
}

/** Collects events in memory; the default when no bus is configured, and handy in tests. */
export class MemoryEventBus implements EventBus {
  readonly events: DomainEvent[] = [];
  async publish(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }
}
