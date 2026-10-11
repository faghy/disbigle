/** Something that happened in the domain, for streaming, federation and background work. */
export type DomainEvent =
  | { type: 'post.created'; postId: string; actorId: string }
  | {
      type: 'post.deleted';
      postId: string;
      actorId: string;
      apUri: string | null;
      diasporaGuid: string | null;
      /** Explicit recipients at deletion time (followers are resolved by the receiver). */
      audienceActorIds: string[];
      visibility: 'public' | 'unlisted' | 'followers' | 'limited' | 'direct';
      reblogOfId: string | null;
      /** First post of the thread (diaspora sends comments to the thread root). */
      threadRootId: string | null;
    }
  | { type: 'notification.created'; notificationId: string; recipientActorId: string }
  | {
      type: 'follow.created';
      followId: string;
      actorId: string;
      targetActorId: string;
      apUri: string | null;
    }
  | { type: 'follow.requested'; actorId: string; targetActorId: string; apUri: string | null }
  | { type: 'follow.removed'; actorId: string; targetActorId: string; apUri: string | null }
  | { type: 'follow.rejected'; actorId: string; targetActorId: string; apUri: string | null }
  | { type: 'like.created'; likeId: string; actorId: string; postId: string; apUri: string | null }
  | {
      type: 'like.removed';
      actorId: string;
      postId: string;
      apUri: string | null;
      diasporaGuid: string | null;
    }
  | { type: 'profile.updated'; actorId: string }
  | { type: 'block.created'; actorId: string; targetActorId: string }
  | { type: 'account.deleted'; actorId: string }
  | { type: 'post.updated'; postId: string; actorId: string }
  | { type: 'account.moved'; actorId: string; targetActorId: string }
  | { type: 'poll.voted'; pollId: string; postId: string; actorId: string; voteIds: string[] };

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
