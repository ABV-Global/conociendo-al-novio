import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type SubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  language: 'es' | 'en' | 'pt-BR';
};

const messages = {
  es: { title: 'Nuevo audio disponible', body: (name: string) => `“${name}” ya está listo para escuchar.` },
  en: { title: 'New audio available', body: (name: string) => `“${name}” is now ready to listen to.` },
  'pt-BR': { title: 'Novo áudio disponível', body: (name: string) => `“${name}” já está disponível para ouvir.` }
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  if (request.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const isImmediatePublication = payload?.type === 'INSERT' && payload?.record?.status === 'published';
    const isScheduledPublication = payload?.type === 'UPDATE'
      && payload?.old_record?.status !== 'published'
      && payload?.record?.status === 'published';
    if (payload?.table !== 'audios' || !payload?.record?.titulo
      || payload?.record?.notification_sent_at || (!isImmediatePublication && !isScheduledPublication)) {
      return Response.json({ ignored: true });
    }

    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT')!,
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!
    );
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );
    const { data, error } = await supabase.from('push_subscriptions').select('endpoint,p256dh,auth,language');
    if (error) throw error;

    const invalidEndpoints: string[] = [];
    let sent = 0;
    let failed = 0;
    await Promise.allSettled((data as SubscriptionRow[] || []).map(async (subscription) => {
      const language = messages[subscription.language] ? subscription.language : 'es';
      const copy = messages[language];
      const notification = JSON.stringify({
        title: copy.title,
        body: copy.body(payload.record.titulo),
        tag: `audio-${payload.record.id || 'new'}`,
        url: Deno.env.get('APP_URL') || 'https://abv-global.github.io/conociendo-al-novio/'
      });
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth }
        }, notification, { TTL: 86400, urgency: 'normal' });
        sent += 1;
      } catch (pushError) {
        failed += 1;
        const status = Number((pushError as { statusCode?: number }).statusCode || 0);
        if (status === 404 || status === 410) invalidEndpoints.push(subscription.endpoint);
        else console.error('Push failed', status, pushError);
      }
    }));

    if (invalidEndpoints.length) {
      await supabase.from('push_subscriptions').delete().in('endpoint', invalidEndpoints);
    }
    if (sent > 0) {
      await supabase.from('audios').update({ notification_sent_at: new Date().toISOString() }).eq('id', payload.record.id);
    }
    console.log('Push delivery result', { audioId: payload.record.id, sent, failed, removed: invalidEndpoints.length, total: (data || []).length });
    return Response.json({ sent, failed, removed: invalidEndpoints.length, total: (data || []).length });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Unable to send notifications' }, { status: 500 });
  }
});
