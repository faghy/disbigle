-- The tables of a diaspora* PostgreSQL database that the importer reads, as they are after
-- db/migrate/0000_create_schema.rb and every later migration up to 2023 (polymorphic mentions,
-- removed message signatures, two-factor columns, removed chat and facebook, photos without
-- comments_count, notifications guid, users without authentication_token and strip_exif).
-- Rails conventions: serial `id`, string = varchar(255), datetime = timestamp without time zone (UTC).

create table pods (
  id serial primary key,
  host varchar(255),
  ssl boolean,
  created_at timestamp not null,
  updated_at timestamp not null,
  status integer default 0,
  checked_at timestamp default '1970-01-01 00:00:00',
  offline_since timestamp,
  response_time integer default -1,
  software varchar(255),
  error varchar(255),
  port integer,
  blocked boolean default false
);

create table people (
  id serial primary key,
  guid varchar(255) not null,
  diaspora_handle varchar(255) not null,
  serialized_public_key text not null,
  owner_id integer,
  created_at timestamp not null,
  updated_at timestamp not null,
  closed_account boolean default false,
  fetch_status integer default 0,
  pod_id integer references pods (id) on delete cascade
);
create unique index index_people_on_diaspora_handle on people (diaspora_handle);
create unique index index_people_on_guid on people (guid);
create unique index index_people_on_owner_id on people (owner_id);

create table profiles (
  id serial primary key,
  diaspora_handle varchar(255),
  first_name varchar(127),
  last_name varchar(127),
  image_url varchar(255),
  image_url_small varchar(255),
  image_url_medium varchar(255),
  birthday date,
  gender varchar(255),
  bio text,
  searchable boolean not null default true,
  person_id integer not null references people (id) on delete cascade,
  created_at timestamp not null,
  updated_at timestamp not null,
  location varchar(255),
  full_name varchar(70),
  nsfw boolean default false,
  public_details boolean default false
);
create index index_profiles_on_person_id on profiles (person_id);

create table users (
  id serial primary key,
  username varchar(255) not null,
  serialized_private_key text,
  getting_started boolean not null default true,
  disable_mail boolean not null default false,
  language varchar(255),
  email varchar(255) not null default '',
  encrypted_password varchar(255) not null default '',
  reset_password_token varchar(255),
  remember_created_at timestamp,
  sign_in_count integer default 0,
  current_sign_in_at timestamp,
  last_sign_in_at timestamp,
  current_sign_in_ip varchar(255),
  last_sign_in_ip varchar(255),
  created_at timestamp not null,
  updated_at timestamp not null,
  invited_by_id integer,
  unconfirmed_email varchar(255),
  confirm_email_token varchar(30),
  locked_at timestamp,
  show_community_spotlight_in_stream boolean not null default true,
  auto_follow_back boolean default false,
  auto_follow_back_aspect_id integer,
  hidden_shareables text,
  reset_password_sent_at timestamp,
  last_seen timestamp,
  remove_after timestamp,
  export varchar(255),
  exported_at timestamp,
  exporting boolean default false,
  exported_photos_file varchar(255),
  exported_photos_at timestamp,
  exporting_photos boolean default false,
  color_theme varchar(255),
  post_default_public boolean default false,
  consumed_timestep integer,
  otp_required_for_login boolean,
  otp_backup_codes text,
  plain_otp_secret varchar(255)
);
create unique index index_users_on_username on users (username);
create unique index index_users_on_email on users (email);

create table roles (
  id serial primary key,
  person_id integer,
  name varchar(255),
  created_at timestamp not null,
  updated_at timestamp not null
);

create table aspects (
  id serial primary key,
  name varchar(255) not null,
  user_id integer not null,
  created_at timestamp not null,
  updated_at timestamp not null,
  order_id integer,
  post_default boolean default true
);
create unique index index_aspects_on_user_id_and_name on aspects (user_id, name);

create table contacts (
  id serial primary key,
  user_id integer not null,
  person_id integer not null references people (id) on delete cascade,
  created_at timestamp not null,
  updated_at timestamp not null,
  sharing boolean not null default false,
  receiving boolean not null default false
);
create unique index index_contacts_on_user_id_and_person_id on contacts (user_id, person_id);

create table aspect_memberships (
  id serial primary key,
  aspect_id integer not null references aspects (id) on delete cascade,
  contact_id integer not null references contacts (id) on delete cascade,
  created_at timestamp not null,
  updated_at timestamp not null
);
create unique index index_aspect_memberships_on_aspect_id_and_contact_id
  on aspect_memberships (aspect_id, contact_id);

create table posts (
  id serial primary key,
  author_id integer not null references people (id) on delete cascade,
  public boolean not null default false,
  guid varchar(255) not null,
  type varchar(40) not null,
  text text,
  created_at timestamp not null,
  updated_at timestamp not null,
  provider_display_name varchar(255),
  root_guid varchar(255),
  likes_count integer default 0,
  comments_count integer default 0,
  o_embed_cache_id integer,
  reshares_count integer default 0,
  interacted_at timestamp,
  tweet_id varchar(255),
  open_graph_cache_id integer,
  tumblr_ids text
);
create unique index index_posts_on_guid on posts (guid);
create unique index index_posts_on_author_id_and_root_guid on posts (author_id, root_guid);

create table photos (
  id serial primary key,
  author_id integer not null,
  public boolean not null default false,
  guid varchar(255) not null,
  pending boolean not null default false,
  text text,
  remote_photo_path text,
  remote_photo_name varchar(255),
  random_string varchar(255),
  processed_image varchar(255),
  created_at timestamp,
  updated_at timestamp,
  unprocessed_image varchar(255),
  status_message_guid varchar(255),
  height integer,
  width integer
);
create unique index index_photos_on_guid on photos (guid);
create index index_photos_on_status_message_guid on photos (status_message_guid);

create table polls (
  id serial primary key,
  question varchar(255) not null,
  status_message_id integer not null,
  status boolean,
  guid varchar(255),
  created_at timestamp,
  updated_at timestamp
);

create table poll_answers (
  id serial primary key,
  answer varchar(255) not null,
  poll_id integer not null,
  guid varchar(255),
  vote_count integer default 0
);

create table poll_participations (
  id serial primary key,
  poll_answer_id integer not null,
  author_id integer not null,
  poll_id integer not null,
  guid varchar(255),
  created_at timestamp,
  updated_at timestamp
);
create unique index index_poll_participations_on_poll_id_and_author_id
  on poll_participations (poll_id, author_id);

create table aspect_visibilities (
  id serial primary key,
  shareable_id integer not null,
  aspect_id integer not null references aspects (id) on delete cascade,
  shareable_type varchar(255) not null default 'Post'
);

create table share_visibilities (
  id serial primary key,
  shareable_id integer not null,
  hidden boolean not null default false,
  shareable_type varchar(60) not null default 'Post',
  user_id integer not null references users (id) on delete cascade
);

create table mentions (
  id serial primary key,
  mentions_container_id integer not null,
  person_id integer not null,
  mentions_container_type varchar(255) not null
);

create table tags (
  id serial primary key,
  name varchar(255),
  taggings_count integer default 0
);
create unique index index_tags_on_name on tags (name);

create table taggings (
  id serial primary key,
  tag_id integer,
  taggable_id integer,
  taggable_type varchar(127),
  tagger_id integer,
  tagger_type varchar(127),
  context varchar(127),
  created_at timestamp
);

create table comments (
  id serial primary key,
  text text not null,
  commentable_id integer not null,
  author_id integer not null references people (id) on delete cascade,
  guid varchar(255) not null,
  created_at timestamp not null,
  updated_at timestamp not null,
  likes_count integer not null default 0,
  commentable_type varchar(60) not null default 'Post'
);
create unique index index_comments_on_guid on comments (guid);

create table likes (
  id serial primary key,
  positive boolean default true,
  target_id integer,
  author_id integer references people (id) on delete cascade,
  guid varchar(255),
  created_at timestamp not null,
  updated_at timestamp not null,
  target_type varchar(60) not null
);
create unique index index_likes_on_guid on likes (guid);
create unique index index_likes_on_target_id_and_author_id_and_target_type
  on likes (target_id, author_id, target_type);

create table conversations (
  id serial primary key,
  subject varchar(255),
  guid varchar(255) not null,
  author_id integer not null references people (id) on delete cascade,
  created_at timestamp not null,
  updated_at timestamp not null
);
create unique index index_conversations_on_guid on conversations (guid);

create table conversation_visibilities (
  id serial primary key,
  conversation_id integer not null references conversations (id) on delete cascade,
  person_id integer not null references people (id) on delete cascade,
  unread integer not null default 0,
  created_at timestamp not null,
  updated_at timestamp not null
);

create table messages (
  id serial primary key,
  conversation_id integer not null references conversations (id) on delete cascade,
  author_id integer not null references people (id) on delete cascade,
  guid varchar(255) not null,
  text text not null,
  created_at timestamp not null,
  updated_at timestamp not null
);
create unique index index_messages_on_guid on messages (guid);
