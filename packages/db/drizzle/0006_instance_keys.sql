CREATE TABLE "instance_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"rsa_private_key_pem" text NOT NULL,
	"rsa_public_key_pem" text NOT NULL,
	"ed25519_private_key_pem" text NOT NULL,
	"ed25519_public_key_pem" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
