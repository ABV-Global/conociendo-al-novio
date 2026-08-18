import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const allowedOrigins = new Set([
  'https://abv-global.github.io',
  'http://localhost:8000',
  'http://localhost:8080',
  'http://localhost:5500'
]);

const isLocalOrigin = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);

function cors(origin: string | null) {
  const allowed = origin && (allowedOrigins.has(origin) || isLocalOrigin(origin));
  return {
    'Access-Control-Allow-Origin': allowed ? origin! : 'https://abv-global.github.io',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  };
}

function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'categoria';
}

function safeFileName(value: string) {
  const extension = value.toLowerCase().match(/\.(mp3|m4a|mp4)$/)?.[1] || 'mp3';
  const base = slugify(value.replace(/\.[^.]+$/, '')).slice(0, 70) || 'audio';
  return `${crypto.randomUUID()}-${base}.${extension}`;
}

async function translateCategory(nameEs: string) {
  const normalized = nameEs.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const glossary: Record<string, { nameEn: string; namePtBr: string }> = {
    biblia: { nameEn: 'Bible', namePtBr: 'Bíblia' },
    libros: { nameEn: 'Books', namePtBr: 'Livros' },
    mateo: { nameEn: 'Matthew', namePtBr: 'Mateus' },
    marcos: { nameEn: 'Mark', namePtBr: 'Marcos' },
    lucas: { nameEn: 'Luke', namePtBr: 'Lucas' },
    juan: { nameEn: 'John', namePtBr: 'João' },
    hechos: { nameEn: 'Acts', namePtBr: 'Atos' },
    romanos: { nameEn: 'Romans', namePtBr: 'Romanos' },
    corintios: { nameEn: 'Corinthians', namePtBr: 'Coríntios' },
    galatas: { nameEn: 'Galatians', namePtBr: 'Gálatas' },
    efesios: { nameEn: 'Ephesians', namePtBr: 'Efésios' },
    filipenses: { nameEn: 'Philippians', namePtBr: 'Filipenses' },
    colosenses: { nameEn: 'Colossians', namePtBr: 'Colossenses' },
    tesalonicenses: { nameEn: 'Thessalonians', namePtBr: 'Tessalonicenses' },
    timoteo: { nameEn: 'Timothy', namePtBr: 'Timóteo' },
    tito: { nameEn: 'Titus', namePtBr: 'Tito' },
    filemon: { nameEn: 'Philemon', namePtBr: 'Filemom' },
    hebreos: { nameEn: 'Hebrews', namePtBr: 'Hebreus' },
    santiago: { nameEn: 'James', namePtBr: 'Tiago' },
    pedro: { nameEn: 'Peter', namePtBr: 'Pedro' },
    judas: { nameEn: 'Jude', namePtBr: 'Judas' },
    apocalipsis: { nameEn: 'Revelation', namePtBr: 'Apocalipse' }
  };
  if (glossary[normalized]) return glossary[normalized];
  const key = Deno.env.get('DEEPL_API_KEY');
  if (!key) return { nameEn: nameEs, namePtBr: nameEs };
  const endpoint = key.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
  const translate = async (targetLang: 'EN' | 'PT-BR') => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: [nameEs], source_lang: 'ES', target_lang: targetLang })
    });
    const result = await response.json();
    if (!response.ok || !result?.translations?.[0]?.text) throw new Error('The folder name could not be translated');
    return String(result.translations[0].text).trim().slice(0, 80);
  };
  try {
    const [nameEn, namePtBr] = await Promise.all([translate('EN'), translate('PT-BR')]);
    return { nameEn, namePtBr };
  } catch (error) {
    console.error('Category translation failed; saving the Spanish name as fallback', error);
    return { nameEn: nameEs, namePtBr: nameEs };
  }
}

async function sendPushToCommunity(supabase: ReturnType<typeof createClient>, title: string, message: string, tag: string) {
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
  const { data, error } = await supabase.from('push_subscriptions').select('endpoint,p256dh,auth');
  if (error) throw error;
  const invalid: string[] = [];
  let sent = 0;
  await Promise.allSettled((data || []).map(async (subscription) => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title, body: message, tag, url: Deno.env.get('APP_URL') }), { TTL: 86400, urgency: 'normal' });
      sent += 1;
    } catch (pushError) {
      const status = Number((pushError as { statusCode?: number }).statusCode || 0);
      if (status === 404 || status === 410) invalid.push(subscription.endpoint);
    }
  }));
  if (invalid.length) await supabase.from('push_subscriptions').delete().in('endpoint', invalid);
  return sent;
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  const headers = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  if (origin && !allowedOrigins.has(origin) && !isLocalOrigin(origin)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers });
  }

  try {
    const body = await request.json();
    if (!body?.password || body.password !== Deno.env.get('ADMIN_PASSWORD')) {
      return new Response(JSON.stringify({ error: 'Invalid administrator password' }), { status: 401, headers });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );
    const action = String(body.action || '');

    if (action === 'authenticate') return new Response(JSON.stringify({ ok: true }), { headers });

    if (action === 'start-journey') {
      const { data: existing, error: readError } = await supabase.from('journey_settings').select('started_at').eq('id', 1).maybeSingle();
      if (readError) throw readError;
      if (existing?.started_at) return new Response(JSON.stringify({ error: 'The journey has already started' }), { status: 409, headers });
      const startedAt = new Date().toISOString();
      const { error } = await supabase.from('journey_settings').upsert({ id: 1, started_at: startedAt, updated_at: startedAt });
      if (error) throw error;
      const sent = await sendPushToCommunity(supabase, 'Conociendo al Novio', 'La jornada ha comenzado. Hoy caminamos juntas en el Día 1.', 'journey-started');
      return new Response(JSON.stringify({ started_at: startedAt, sent }), { headers });
    }

    if (action === 'send-announcement') {
      const message = String(body.message || '').trim().slice(0, 500);
      if (!message) return new Response(JSON.stringify({ error: 'The message is required' }), { status: 400, headers });
      const { error: clearError } = await supabase.from('community_announcements').update({ is_current: false }).eq('is_current', true);
      if (clearError) throw clearError;
      const { data: announcement, error } = await supabase.from('community_announcements').insert({ message, is_current: true }).select('id,message,created_at').single();
      if (error) throw error;
      const sent = await sendPushToCommunity(supabase, 'Amigas del Novio', message, `announcement-${announcement.id}`);
      return new Response(JSON.stringify({ announcement, sent }), { headers });
    }

    if (action === 'list-admin') {
      const [categoryResult, audioResult, journeyResult, announcementResult] = await Promise.all([
        supabase.from('categories').select('id,name,name_es,name_en,name_pt_br,slug,parent_id,sort_order').order('sort_order').order('name'),
        supabase.from('audios').select('id,titulo,url,storage_path,category_id,status,scheduled_at,published_at,created_at').order('created_at', { ascending: false }),
        supabase.from('journey_settings').select('started_at').eq('id', 1).maybeSingle(),
        supabase.from('community_announcements').select('message,created_at').eq('is_current', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
      ]);
      if (categoryResult.error) throw categoryResult.error;
      if (audioResult.error) throw audioResult.error;
      if (journeyResult.error) throw journeyResult.error;
      if (announcementResult.error) throw announcementResult.error;
      return new Response(JSON.stringify({ categories: categoryResult.data, audios: audioResult.data, journey: journeyResult.data, announcement: announcementResult.data }), { headers });
    }

    if (action === 'create-category') {
      const nameEs = String(body.nameEs || '').trim().slice(0, 80);
      const parentId = body.parentId ? Number(body.parentId) : null;
      if (!nameEs) return new Response(JSON.stringify({ error: 'The Spanish folder name is required' }), { status: 400, headers });
      if (parentId) {
        const { data: parent, error: parentError } = await supabase.from('categories').select('id,parent_id').eq('id', parentId).single();
        if (parentError || !parent || parent.parent_id) return new Response(JSON.stringify({ error: 'A subfolder can only be created inside a main folder' }), { status: 400, headers });
      }
      const { nameEn, namePtBr } = await translateCategory(nameEs);
      const slug = `${slugify(nameEs)}-${crypto.randomUUID().slice(0, 6)}`;
      const { data, error } = await supabase.from('categories')
        .insert({ name: nameEs, name_es: nameEs, name_en: nameEn, name_pt_br: namePtBr, slug, parent_id: parentId })
        .select('id,name,name_es,name_en,name_pt_br,slug,parent_id,sort_order').single();
      if (error) throw error;
      return new Response(JSON.stringify({ category: data }), { headers });
    }

    if (action === 'create-upload') {
      const fileName = safeFileName(String(body.fileName || 'audio.mp3'));
      const path = `capitulos/${fileName}`;
      const { data, error } = await supabase.storage.from('audios-conociendo-al-novio').createSignedUploadUrl(path);
      if (error) throw error;
      return new Response(JSON.stringify({ path, token: data.token }), { headers });
    }

    if (action === 'save-audio') {
      const title = String(body.title || '').trim().slice(0, 140);
      const categoryId = Number(body.categoryId);
      const mode = body.mode === 'scheduled' ? 'scheduled' : 'published';
      const scheduledAt = mode === 'scheduled' ? new Date(body.scheduledAt) : null;
      if (!title || !categoryId || !body.url || !body.storagePath) {
        return new Response(JSON.stringify({ error: 'Missing audio information' }), { status: 400, headers });
      }
      if (mode === 'scheduled' && (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now())) {
        return new Response(JSON.stringify({ error: 'Scheduled time must be in the future' }), { status: 400, headers });
      }
      const record = {
        titulo: title,
        url: String(body.url),
        storage_path: String(body.storagePath),
        category_id: categoryId,
        status: mode,
        scheduled_at: scheduledAt?.toISOString() || null,
        published_at: mode === 'published' ? new Date().toISOString() : null
      };
      const { data, error } = await supabase.from('audios').insert(record).select().single();
      if (error) throw error;
      return new Response(JSON.stringify({ audio: data }), { headers });
    }

    if (action === 'publish-now') {
      const { data, error } = await supabase.from('audios').update({
        status: 'published', scheduled_at: null, published_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq('id', Number(body.audioId)).neq('status', 'published').select().single();
      if (error) throw error;
      return new Response(JSON.stringify({ audio: data }), { headers });
    }

    if (action === 'cancel-schedule') {
      const { data, error } = await supabase.from('audios').update({
        status: 'draft', scheduled_at: null, updated_at: new Date().toISOString()
      }).eq('id', Number(body.audioId)).eq('status', 'scheduled').select().single();
      if (error) throw error;
      return new Response(JSON.stringify({ audio: data }), { headers });
    }

    if (action === 'delete-audio') {
      const audioId = Number(body.audioId);
      const { data: audio, error: readError } = await supabase.from('audios')
        .select('id,storage_path').eq('id', audioId).single();
      if (readError) throw readError;
      if (audio.storage_path) {
        const { error: storageError } = await supabase.storage
          .from('audios-conociendo-al-novio').remove([audio.storage_path]);
        if (storageError) throw storageError;
      }
      const { error } = await supabase.from('audios').delete().eq('id', audioId);
      if (error) throw error;
      return new Response(JSON.stringify({ deleted: true }), { headers });
    }

    if (action === 'delete-category') {
      const categoryId = Number(body.categoryId);
      const { data: category, error: categoryError } = await supabase.from('categories')
        .select('id,slug').eq('id', categoryId).single();
      if (categoryError) throw categoryError;
      if (category.slug === 'sin-categoria') {
        return new Response(JSON.stringify({ error: 'The Uncategorized folder cannot be deleted' }), { status: 400, headers });
      }
      const { data: allCategories, error: listError } = await supabase.from('categories').select('id,parent_id');
      if (listError) throw listError;
      const categoryIds = new Set<number>([categoryId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const item of allCategories || []) {
          if (item.parent_id && categoryIds.has(Number(item.parent_id)) && !categoryIds.has(Number(item.id))) {
            categoryIds.add(Number(item.id)); changed = true;
          }
        }
      }
      const { data: fallback, error: fallbackError } = await supabase.from('categories')
        .select('id').eq('slug', 'sin-categoria').single();
      if (fallbackError) throw fallbackError;
      const { error: moveError } = await supabase.from('audios')
        .update({ category_id: fallback.id, updated_at: new Date().toISOString() }).in('category_id', [...categoryIds]);
      if (moveError) throw moveError;
      const { error } = await supabase.from('categories').delete().eq('id', categoryId);
      if (error) throw error;
      return new Response(JSON.stringify({ deleted: true, movedAudios: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unexpected error' }), { status: 500, headers });
  }
});
