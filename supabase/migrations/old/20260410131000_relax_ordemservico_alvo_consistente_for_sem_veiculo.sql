alter table public.ordemservico
drop constraint if exists ordemservico_alvo_consistente;

alter table public.ordemservico
add constraint ordemservico_alvo_consistente
check (
  (
    alvo_tipo = 'VEICULO'::public.enum_alvo_reparo
    and pecaid is null
  )
  or (
    alvo_tipo = 'PECA'::public.enum_alvo_reparo
    and pecaid is not null
    and veiculoid is null
  )
);
