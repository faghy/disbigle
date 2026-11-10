/**
 * Fills a development database for the App Store screenshots: one small world per language
 * (Italian, English, Spanish), each seen from its own account, with photos, a poll, replies,
 * likes, notifications and private conversations. Refuses to run in production.
 *
 *   pnpm --filter @disbigle/server seed-screenshots
 *
 * The accounts seen from are `giulia` (it), `emma` (en) and `lucia` (es); password
 * `disbigle-demo`, as in seed.ts.
 */
import { loadConfig } from '@disbigle/config';
import {
  type CoreContext,
  createPost,
  follow,
  LocalMediaStorage,
  like,
  MemoryKeyValueStore,
  reblog,
  registerUser,
  updateProfile,
  updateProfileImage,
  uploadMedia,
  votePoll,
} from '@disbigle/core';
import { createDatabase } from '@disbigle/db';
import sharp from 'sharp';

const config = loadConfig();
if (config.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
const { db, close } = createDatabase(config.DATABASE_URL);
const storage = new LocalMediaStorage(config.MEDIA_DIR);
const ctx = {
  db,
  config,
  kv: new MemoryKeyValueStore(),
  rsaKeyBits: 2048,
  storage,
} as CoreContext & {
  storage: LocalMediaStorage;
};
const PASSWORD = 'disbigle-demo';

// --- Pictures, drawn here so the seed needs nothing from the network. ---

type Scene = 'mountains' | 'lake' | 'autumn' | 'sea' | 'city';

function sceneSvg(scene: Scene, width = 1600, height = 1000): string {
  const w = width;
  const h = height;
  const sky: Record<Scene, [string, string]> = {
    mountains: ['#f6b26b', '#6fa8dc'],
    lake: ['#cfe2f3', '#3d85c6'],
    autumn: ['#ffe599', '#e69138'],
    sea: ['#f9cb9c', '#e06666'],
    city: ['#20124d', '#a64d79'],
  };
  const [top, bottom] = sky[scene];
  const parts: string[] = [
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bottom}"/><stop offset="1" stop-color="${top}"/></linearGradient></defs>`,
    `<rect width="${w}" height="${h}" fill="url(#s)"/>`,
  ];
  if (scene === 'mountains') {
    parts.push(
      `<circle cx="${w * 0.72}" cy="${h * 0.32}" r="${h * 0.08}" fill="#fff2cc"/>`,
      `<polygon points="0,${h * 0.75} ${w * 0.22},${h * 0.3} ${w * 0.42},${h * 0.7} ${w * 0.6},${h * 0.25} ${w * 0.85},${h * 0.65} ${w},${h * 0.45} ${w},${h} 0,${h}" fill="#5b6b7a"/>`,
      `<polygon points="${w * 0.17},${h * 0.39} ${w * 0.22},${h * 0.3} ${w * 0.27},${h * 0.4} ${w * 0.23},${h * 0.37}" fill="#ffffff"/>`,
      `<polygon points="${w * 0.55},${h * 0.34} ${w * 0.6},${h * 0.25} ${w * 0.66},${h * 0.35} ${w * 0.61},${h * 0.32}" fill="#ffffff"/>`,
      `<polygon points="0,${h * 0.85} ${w * 0.3},${h * 0.62} ${w * 0.55},${h * 0.82} ${w * 0.8},${h * 0.6} ${w},${h * 0.8} ${w},${h} 0,${h}" fill="#38761d"/>`,
    );
  } else if (scene === 'lake') {
    parts.push(
      `<polygon points="0,${h * 0.58} ${w * 0.25},${h * 0.2} ${w * 0.45},${h * 0.58}" fill="#4a5a66"/>`,
      `<polygon points="${w * 0.35},${h * 0.58} ${w * 0.62},${h * 0.15} ${w},${h * 0.58}" fill="#5f6f7b"/>`,
      `<rect y="${h * 0.58}" width="${w}" height="${h * 0.42}" fill="#2f7f8f"/>`,
      `<polygon points="0,${h * 0.58} ${w * 0.25},${h * 0.92} ${w * 0.45},${h * 0.58}" fill="#3b6f7a" opacity="0.7"/>`,
      `<polygon points="${w * 0.35},${h * 0.58} ${w * 0.62},${h * 0.98} ${w},${h * 0.58}" fill="#43777f" opacity="0.7"/>`,
      `<rect x="${w * 0.47}" y="${h * 0.6}" width="${w * 0.08}" height="${h * 0.025}" rx="8" fill="#7f4f24"/>`,
    );
  } else if (scene === 'autumn') {
    parts.push(
      `<ellipse cx="${w * 0.25}" cy="${h}" rx="${w * 0.5}" ry="${h * 0.45}" fill="#b45f06"/>`,
      `<ellipse cx="${w * 0.8}" cy="${h}" rx="${w * 0.55}" ry="${h * 0.38}" fill="#783f04"/>`,
      ...[0.15, 0.3, 0.62, 0.78].map(
        (x, i) =>
          `<rect x="${w * x - 10}" y="${h * (0.5 + (i % 2) * 0.06)}" width="20" height="${h * 0.2}" fill="#4a2b0f"/><circle cx="${w * x}" cy="${h * (0.48 + (i % 2) * 0.06)}" r="${h * 0.11}" fill="${['#cc4125', '#f1c232', '#e69138', '#a61c00'][i]}"/>`,
      ),
    );
  } else if (scene === 'sea') {
    parts.push(
      `<circle cx="${w * 0.5}" cy="${h * 0.55}" r="${h * 0.14}" fill="#ffe599"/>`,
      `<rect y="${h * 0.55}" width="${w}" height="${h * 0.45}" fill="#1c4587"/>`,
      ...[0.62, 0.7, 0.8, 0.9].map(
        (y, i) =>
          `<rect x="${w * (0.42 - i * 0.03)}" y="${h * y}" width="${w * (0.16 + i * 0.06)}" height="6" rx="3" fill="#ffe599" opacity="${0.8 - i * 0.15}"/>`,
      ),
    );
  } else {
    parts.push(
      ...Array.from({ length: 14 }, (_, i) => {
        const bw = w / 14;
        const bh = h * (0.25 + ((i * 37) % 30) / 100);
        return `<rect x="${i * bw}" y="${h - bh}" width="${bw - 6}" height="${bh}" fill="#0c0a1f"/>${Array.from(
          { length: 6 },
          (_, j) =>
            `<rect x="${i * bw + 14 + (j % 2) * 34}" y="${h - bh + 30 + Math.floor(j / 2) * 60}" width="18" height="26" fill="#ffd966" opacity="${(i + j) % 3 === 0 ? 0.2 : 0.9}"/>`,
        ).join('')}`;
      }),
      `<circle cx="${w * 0.82}" cy="${h * 0.2}" r="${h * 0.06}" fill="#fff2cc"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${parts.join('')}</svg>`;
}

const picture = async (scene: Scene, width?: number, height?: number) =>
  sharp(Buffer.from(sceneSvg(scene, width, height)))
    .jpeg({ quality: 88 })
    .toBuffer();

async function photo(actorId: string, scene: Scene, description: string) {
  const media = await uploadMedia(ctx, actorId, {
    data: await picture(scene),
    mimeType: 'image/jpeg',
    description,
  });
  return media.id;
}

// --- The worlds. ---

interface Person {
  username: string;
  name: string;
  bio: string;
}

interface World {
  locale: 'it' | 'en' | 'es';
  me: Person;
  friends: [Person, Person, Person];
  club: Person;
  text: {
    sunrise: string;
    sunriseAlt: string;
    poll: string;
    pollOptions: string[];
    moved: string;
    clubWalk: string;
    clubAlt: string;
    myAlbum: string;
    myAlbumAlt: string;
    myPost: string;
    seaPost: string;
    seaAlt: string;
    cityPost: string;
    cityAlt: string;
    replies: [string, string, string];
    chat1: string[];
    chat2: string[];
    chat3: string;
  };
}

const worlds: World[] = [
  {
    locale: 'it',
    me: {
      username: 'giulia',
      name: 'Giulia Ferri',
      bio: 'Fotografa di montagna, sentieri e caffè. Su diaspora* dal 2012, ora su Disbigle.',
    },
    friends: [
      { username: 'marco', name: 'Marco Bianchi', bio: 'Cuoco per passione, ciclista per scelta.' },
      { username: 'sara', name: 'Sara Conti', bio: 'Alpinista e insegnante di scienze.' },
      {
        username: 'luca',
        name: 'Luca Moretti',
        bio: 'Sviluppatore open source. Fediverso dal 2017.',
      },
    ],
    club: {
      username: 'fotografia_dolomiti',
      name: 'Fotografia Dolomiti',
      bio: 'Uscite fotografiche in montagna, aperte a tutti.',
    },
    text: {
      sunrise:
        'Alba sulle Dolomiti stamattina 🌄 sveglia alle 4, ma ne è valsa la pena. #fotografia #montagna',
      sunriseAlt: 'Alba sulle cime innevate, cielo arancione e prati verdi',
      poll: 'Gita di domenica: dove andiamo?',
      pollOptions: ['Lago di Braies', 'Val di Funes', 'Cinque Terre'],
      moved:
        'Ho portato qui il mio account da Mastodon: in un minuto mi hanno ritrovato tutti. E vedo ancora gli amici di diaspora* 💛 #fediverso',
      clubWalk:
        'Sabato uscita di fotografia al lago, ritrovo alle 7 al parcheggio. Portate il cavalletto! #fotografia',
      clubAlt: 'Lago di montagna con le cime riflesse nell’acqua',
      myAlbum: 'Nuovo album: autunno in Val di Funes 🍂 #fotografia #autunno',
      myAlbumAlt: 'Colline autunnali con alberi rossi e gialli',
      myPost:
        'Niente pubblicità, niente algoritmo: solo le persone che seguo. Ci voleva! #disbigle',
      seaPost: 'Tramonto in Liguria, ultimo bagno della stagione 🌅',
      seaAlt: 'Sole che tramonta sul mare',
      cityPost: 'Milano di notte dal 30° piano. #fotografia',
      cityAlt: 'Grattacieli illuminati di notte',
      replies: ['Che colori! 😍', 'Vengo anch’io sabato!', 'Bellissima, che obiettivo hai usato?'],
      chat1: [
        'Ciao Giulia! Domenica confermata la gita?',
        'Sì! Partenza alle 7, passo a prenderti io 🚗',
        'Perfetto, porto i panini e il caffè ☕',
        'Grande! Ricordati la giacca, in quota fa freddo',
      ],
      chat2: [
        'Mi mandi le foto dell’alba? Le stampo per la mostra',
        'Certo, te le preparo stasera 📸',
      ],
      chat3: 'Grazie per l’invito al gruppo, ci vediamo alla prossima uscita!',
    },
  },
  {
    locale: 'en',
    me: {
      username: 'emma',
      name: 'Emma Walker',
      bio: 'Landscape photographer, trail runner and tea lover. Here since day one.',
    },
    friends: [
      { username: 'james', name: 'James Carter', bio: 'Home cook, weekend cyclist.' },
      { username: 'olivia', name: 'Olivia Hughes', bio: 'Climber and science teacher.' },
      {
        username: 'noah',
        name: 'Noah Bennett',
        bio: 'Open source developer. On the fediverse since 2017.',
      },
    ],
    club: {
      username: 'photowalks',
      name: 'Photo Walks',
      bio: 'Photography walks in the hills, open to everyone.',
    },
    text: {
      sunrise:
        'Sunrise over the peaks this morning 🌄 up at 4am, totally worth it. #photography #mountains',
      sunriseAlt: 'Sunrise over snowy peaks, orange sky and green meadows',
      poll: 'Sunday trip: where shall we go?',
      pollOptions: ['Lake District', 'Snowdonia', 'Scottish Highlands'],
      moved:
        'Moved my account here from Mastodon: everyone found me again within a minute. And I still see my diaspora* friends 💛 #fediverse',
      clubWalk:
        'Photo walk by the lake on Saturday, meeting at 7 at the car park. Bring a tripod! #photography',
      clubAlt: 'Mountain lake with the peaks reflected in the water',
      myAlbum: 'New album: autumn in the valley 🍂 #photography #autumn',
      myAlbumAlt: 'Autumn hills with red and yellow trees',
      myPost: 'No ads, no algorithm: just the people I follow. Long overdue! #disbigle',
      seaPost: 'Sunset on the coast, last swim of the season 🌅',
      seaAlt: 'The sun setting over the sea',
      cityPost: 'The city at night from the 30th floor. #photography',
      cityAlt: 'Skyscrapers lit up at night',
      replies: [
        'Those colours! 😍',
        'Count me in for Saturday!',
        'Stunning, which lens did you use?',
      ],
      chat1: [
        'Hi Emma! Is the Sunday trip still on?',
        'Yes! Leaving at 7, I’ll pick you up 🚗',
        'Perfect, I’ll bring sandwiches and coffee ☕',
        'Great! Bring a jacket, it’s cold up there',
      ],
      chat2: [
        'Can you send me the sunrise photos? I’m printing them for the show',
        'Sure, I’ll get them ready tonight 📸',
      ],
      chat3: 'Thanks for the invite to the group, see you at the next walk!',
    },
  },
  {
    locale: 'es',
    me: {
      username: 'lucia',
      name: 'Lucía García',
      bio: 'Fotógrafa de montaña, senderos y café. Antes en diaspora*, ahora en Disbigle.',
    },
    friends: [
      {
        username: 'pablo',
        name: 'Pablo Ruiz',
        bio: 'Cocinero por afición, ciclista por elección.',
      },
      { username: 'carmen', name: 'Carmen López', bio: 'Escaladora y profesora de ciencias.' },
      {
        username: 'javier',
        name: 'Javier Torres',
        bio: 'Desarrollador de software libre. En el fediverso desde 2017.',
      },
    ],
    club: {
      username: 'fotos_sierra',
      name: 'Fotos de la Sierra',
      bio: 'Salidas fotográficas por la montaña, abiertas a todo el mundo.',
    },
    text: {
      sunrise:
        'Amanecer en los Picos de Europa 🌄 madrugón a las 4, pero mereció la pena. #fotos #montaña',
      sunriseAlt: 'Amanecer sobre cumbres nevadas, cielo naranja y prados verdes',
      poll: 'Excursión del domingo: ¿adónde vamos?',
      pollOptions: ['Picos de Europa', 'Sierra de Gredos', 'Costa Brava'],
      moved:
        'He traído mi cuenta desde Mastodon: en un minuto me encontraron todos. Y sigo viendo a mis amigos de diaspora* 💛 #fediverso',
      clubWalk:
        'El sábado salida de fotos al lago, quedamos a las 7 en el aparcamiento. ¡Traed trípode! #fotos',
      clubAlt: 'Lago de montaña con las cumbres reflejadas en el agua',
      myAlbum: 'Nuevo álbum: otoño en el valle 🍂 #fotos #otoño',
      myAlbumAlt: 'Colinas otoñales con árboles rojos y amarillos',
      myPost: 'Sin publicidad, sin algoritmo: solo las personas que sigo. ¡Ya tocaba! #disbigle',
      seaPost: 'Atardecer en la costa, último baño de la temporada 🌅',
      seaAlt: 'El sol poniéndose sobre el mar',
      cityPost: 'Madrid de noche desde el piso 30. #fotos',
      cityAlt: 'Rascacielos iluminados de noche',
      replies: ['¡Qué colores! 😍', '¡El sábado me apunto!', 'Preciosa, ¿qué objetivo usaste?'],
      chat1: [
        '¡Hola Lucía! ¿Sigue en pie la excursión del domingo?',
        '¡Sí! Salimos a las 7, paso a buscarte 🚗',
        'Perfecto, yo llevo bocadillos y café ☕',
        '¡Genial! Trae chaqueta, arriba hace frío',
      ],
      chat2: [
        '¿Me pasas las fotos del amanecer? Las imprimo para la exposición',
        'Claro, te las preparo esta noche 📸',
      ],
      chat3: '¡Gracias por la invitación al grupo, nos vemos en la próxima salida!',
    },
  },
];

async function register(person: Person, locale: World['locale']) {
  const { actorId } = await registerUser(ctx, {
    username: person.username,
    email: `${person.username}@example.com`,
    password: PASSWORD,
    locale,
    agreement: true,
  });
  await updateProfile(ctx, actorId, { displayName: person.name, note: person.bio });
  return actorId;
}

const post = (actorId: string, content: string, extra: Record<string, unknown> = {}) =>
  createPost(ctx, actorId, { content, ...extra });

for (const world of worlds) {
  const { locale, text } = world;
  const me = await register(world.me, locale);
  const [a, b, c] = [
    await register(world.friends[0], locale),
    await register(world.friends[1], locale),
    await register(world.friends[2], locale),
  ];
  const club = await register(world.club, locale);
  await updateProfileImage(ctx, me, 'header', {
    data: await picture('mountains', 1500, 500),
    mimeType: 'image/jpeg',
  });
  await updateProfileImage(ctx, club, 'header', {
    data: await picture('lake', 1500, 500),
    mimeType: 'image/jpeg',
  });

  for (const other of [a, b, c, club]) {
    await follow(ctx, me, other);
    await follow(ctx, other, me);
  }
  await follow(ctx, a, b);
  await follow(ctx, b, c);

  // Oldest first: the timeline shows them newest first.
  const language = locale;
  const city = await post(me, text.cityPost, {
    language,
    mediaIds: [await photo(me, 'city', text.cityAlt)],
  });
  const sea = await post(me, text.seaPost, {
    language,
    mediaIds: [await photo(me, 'sea', text.seaAlt)],
  });
  const moved = await post(c, text.moved, { language });
  const poll = await post(a, text.poll, {
    language,
    poll: { options: text.pollOptions, expiresIn: 2 * 24 * 3600, multiple: false },
  });
  const album = await post(me, text.myAlbum, {
    language,
    mediaIds: [await photo(me, 'autumn', text.myAlbumAlt)],
  });
  const clubWalk = await post(club, text.clubWalk, {
    language,
    mediaIds: [await photo(club, 'lake', text.clubAlt)],
  });
  const mine = await post(me, text.myPost, { language });
  const sunrise = await post(b, text.sunrise, {
    language,
    mediaIds: [await photo(b, 'mountains', text.sunriseAlt)],
  });

  await post(me, text.replies[0], { language, inReplyToId: sunrise.id });
  await post(a, text.replies[1], { language, inReplyToId: clubWalk.id });
  await post(c, text.replies[2], { language, inReplyToId: album.id });
  for (const [who, what] of [
    [a, album],
    [b, album],
    [c, album],
    [club, album],
    [a, mine],
    [b, mine],
    [c, sea],
    [b, city],
    [me, sunrise],
    [a, sunrise],
    [c, sunrise],
    [me, moved],
    [b, moved],
  ] as const) {
    await like(ctx, who, what.id);
  }
  await reblog(ctx, club, album.id);
  await reblog(ctx, a, mine.id);
  const pollId = (poll as { poll?: { id: string } | null }).poll?.id;
  if (pollId) {
    await votePoll(ctx, b, pollId, [0]);
    await votePoll(ctx, c, pollId, [1]);
    await votePoll(ctx, club, pollId, [0]);
  }

  // Private conversations, the newest last.
  const handle = (p: Person) => `@${p.username}`;
  await post(club, `${handle(world.me)} ${text.chat3}`, { language, visibility: 'direct' });
  let reply = await post(b, `${handle(world.me)} ${text.chat2[0]}`, {
    language,
    visibility: 'direct',
  });
  await post(me, `${handle(world.friends[1])} ${text.chat2[1]}`, {
    language,
    visibility: 'direct',
    inReplyToId: reply.id,
  });
  reply = await post(a, `${handle(world.me)} ${text.chat1[0]}`, { language, visibility: 'direct' });
  for (const [index, line] of text.chat1.slice(1).entries()) {
    const from = index % 2 === 0 ? me : a;
    const to = index % 2 === 0 ? world.friends[0] : world.me;
    reply = await post(from, `${handle(to)} ${line}`, {
      language,
      visibility: 'direct',
      inReplyToId: reply.id,
    });
  }
}

console.log(`Seeded screenshot worlds: ${worlds.map((w) => w.me.username).join(', ')}`);
await close();
