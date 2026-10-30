-- Groups made before they reached diaspora*: give them a diaspora* identity.
UPDATE "actors"
SET "diaspora_guid" = substr(md5(random()::text || "id"::text), 1, 16),
    "protocols" = ARRAY['activitypub', 'diaspora']::"protocol"[]
WHERE "is_group" AND "domain" IS NULL AND "diaspora_guid" IS NULL;
