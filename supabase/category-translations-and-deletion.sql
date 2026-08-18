-- Incremental update: multilingual category names.
-- Run after content-management.sql.

begin;

alter table public.categories
  add column if not exists name_es text,
  add column if not exists name_en text,
  add column if not exists name_pt_br text;

update public.categories
set
  name_es = coalesce(name_es, name),
  name_en = coalesce(name_en,
    case slug
      when 'biblia' then 'Bible'
      when 'libros' then 'Books'
      when 'sin-categoria' then 'Uncategorized'
      else name
    end),
  name_pt_br = coalesce(name_pt_br,
    case slug
      when 'biblia' then 'Bíblia'
      when 'libros' then 'Livros'
      when 'sin-categoria' then 'Sem categoria'
      else name
    end);

alter table public.categories
  alter column name_es set not null,
  alter column name_en set not null,
  alter column name_pt_br set not null;

commit;
