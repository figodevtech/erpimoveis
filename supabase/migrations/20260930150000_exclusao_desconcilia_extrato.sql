begin;

-- Excluir uma transação desfaz a conciliação bancária dela.
--
-- `ofx_movimento.transacao_id` é ON DELETE SET NULL, e o CHECK
-- `ofx_movimento_conciliado_tem_transacao_check` exige transação em movimento
-- CONCILIADO. O resultado era o banco recusar qualquer exclusão de linha
-- conciliada, sem que o sistema oferecesse um jeito de desconciliar.
--
-- A regra passou a ser: qualquer exclusão desconcilia. O movimento volta para
-- PENDENTE na conciliação bancária, pronto para ser conciliado de novo. Mora no
-- banco, e não na rota, porque transação some por muitos caminhos — rota
-- individual, lote, RPCs de pagamento múltiplo, lançamento e antecipação,
-- CASCADE da baixa parcial e da transferência — e porque aqui a desconciliação
-- faz parte do mesmo comando: se a exclusão for recusada por outro motivo, ela
-- volta junto.
--
-- A exclusão lógica (`is_deleted`) também conta: movimento conciliado com linha
-- que ninguém mais vê é conciliação de nada.
--
-- `observacao` e `situacao_analise` ficam. São histórico da linha do extrato,
-- não da decisão que está sendo desfeita.

create or replace function public.fn_desconciliar_transacao_excluida()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ofx_movimento
     set status = 'PENDENTE',
         acao_conciliacao = null,
         transacao_id = null,
         titulo_origem_id = null,
         conciliado_em = null,
         conciliado_por = null
   where transacao_id = old.id
     and status = 'CONCILIADO';

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function public.fn_desconciliar_transacao_excluida() owner to postgres;
revoke all on function public.fn_desconciliar_transacao_excluida() from public, anon, authenticated;

comment on function public.fn_desconciliar_transacao_excluida() is
  'Devolve para PENDENTE os movimentos do extrato conciliados com a transação que está sendo excluída (física ou logicamente).';

-- BEFORE: o movimento precisa estar pendente quando o SET NULL da FK chegar,
-- senão o CHECK recusa. Vale também para as linhas levadas por CASCADE.
drop trigger if exists trg_desconciliar_transacao_excluida on public.transacao;
create trigger trg_desconciliar_transacao_excluida
  before delete on public.transacao
  for each row
  execute function public.fn_desconciliar_transacao_excluida();

drop trigger if exists trg_desconciliar_transacao_inativada on public.transacao;
create trigger trg_desconciliar_transacao_inativada
  after update of is_deleted on public.transacao
  for each row
  when (new.is_deleted is true and old.is_deleted is distinct from true)
  execute function public.fn_desconciliar_transacao_excluida();

-- O que já ficou para trás: movimento conciliado com transação excluída
-- logicamente antes desta regra existir.
update public.ofx_movimento m
   set status = 'PENDENTE',
       acao_conciliacao = null,
       transacao_id = null,
       titulo_origem_id = null,
       conciliado_em = null,
       conciliado_por = null
  from public.transacao t
 where t.id = m.transacao_id
   and t.is_deleted is true
   and m.status = 'CONCILIADO';

commit;
