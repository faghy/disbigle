CREATE TABLE "conversation_reads" (
	"actor_id" uuid NOT NULL,
	"thread_root_id" uuid NOT NULL,
	"last_read_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_reads_actor_id_thread_root_id_pk" PRIMARY KEY("actor_id","thread_root_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;