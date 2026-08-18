begin;

alter table public.audios
  add column if not exists descricao text;

comment on column public.audios.descricao is
  'Texto complementar apresentado junto ao áudio na página pública.';

commit;
