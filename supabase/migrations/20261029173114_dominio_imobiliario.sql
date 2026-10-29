-- Imobiliário: identidade externa isolada, inventário, ocupação e razão do proprietário.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

ALTER TABLE public.cliente DROP CONSTRAINT IF EXISTS cliente_nomerazaosocial_key;
REVOKE INSERT, UPDATE ON public.cliente FROM authenticated;
DROP POLICY IF EXISTS cliente_insert_own ON public.cliente;
DROP POLICY IF EXISTS cliente_update_own ON public.cliente;
DROP POLICY IF EXISTS "authenticated can upload vistoria" ON storage.objects;
-- Criação interna passa exclusivamente pelo endpoint ERP, que já faz upsert explícito.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE OR REPLACE FUNCTION public.handle_new_auth_user() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$ BEGIN RETURN new; END $$;

CREATE TABLE public.proprietario (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tipopessoa public.enum_tipopessoa NOT NULL DEFAULT 'FISICA',
 nomerazaosocial text NOT NULL CHECK(length(btrim(nomerazaosocial))>1),
 cpfcnpj text NOT NULL UNIQUE, email text, telefone text, telefones jsonb NOT NULL DEFAULT '[]',
 endereco text, endereconumero text, enderecocomplemento text, bairro text, cidade text, estado text, cep text,
 dados_bancarios jsonb NOT NULL DEFAULT '{}', observacoes text,
 percentual_admin numeric(5,2) NOT NULL DEFAULT 0 CHECK(percentual_admin BETWEEN 0 AND 100),
 ativo boolean NOT NULL DEFAULT true,
 user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
 created_by uuid REFERENCES public.usuario(id), updated_by uuid REFERENCES public.usuario(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(jsonb_typeof(telefones)='array'), CHECK(jsonb_typeof(dados_bancarios)='object'),
 CHECK((tipopessoa='FISICA' AND cpfcnpj ~ '^[0-9]{11}$') OR
       (tipopessoa='JURIDICA' AND public.fiscal_cnpj_normalizar(cpfcnpj)=cpfcnpj AND public.fiscal_cnpj_valido(cpfcnpj)))
);
CREATE UNIQUE INDEX proprietario_email_uidx ON public.proprietario(lower(email)) WHERE email IS NOT NULL;

CREATE TABLE public.imovel (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, proprietario_id bigint NOT NULL REFERENCES public.proprietario(id),
 codigo text UNIQUE, titulo text NOT NULL CHECK(length(btrim(titulo))>1), slug text NOT NULL UNIQUE,
 tipo text NOT NULL DEFAULT 'APARTAMENTO', descricao text, modalidades text[] NOT NULL DEFAULT ARRAY['TEMPORADA'],
 ativo boolean NOT NULL DEFAULT true, publicado boolean NOT NULL DEFAULT false,
 endereco jsonb NOT NULL DEFAULT '{}', endereco_publico jsonb NOT NULL DEFAULT '{}',
 caracteristicas jsonb NOT NULL DEFAULT '{}', comodidades text[] NOT NULL DEFAULT '{}',
 capacidade integer NOT NULL DEFAULT 1 CHECK(capacidade>0), quartos integer NOT NULL DEFAULT 0 CHECK(quartos>=0),
 banheiros integer NOT NULL DEFAULT 0 CHECK(banheiros>=0), vagas integer NOT NULL DEFAULT 0 CHECK(vagas>=0), area numeric(12,2) CHECK(area>=0),
 diaria numeric(14,2) NOT NULL DEFAULT 0 CHECK(diaria>=0), valor_locacao numeric(14,2) NOT NULL DEFAULT 0 CHECK(valor_locacao>=0),
 valor_venda numeric(14,2) NOT NULL DEFAULT 0 CHECK(valor_venda>=0), taxa_limpeza numeric(14,2) NOT NULL DEFAULT 0 CHECK(taxa_limpeza>=0),
 percentual_admin numeric(5,2) NOT NULL DEFAULT 0 CHECK(percentual_admin BETWEEN 0 AND 100),
 min_noites integer NOT NULL DEFAULT 1 CHECK(min_noites>0), max_noites integer CHECK(max_noites>=min_noites),
 regras text, cancelamento jsonb NOT NULL DEFAULT '{}', horario_checkin time NOT NULL DEFAULT '14:00', horario_checkout time NOT NULL DEFAULT '12:00',
 vendido_em date, created_by uuid REFERENCES public.usuario(id), updated_by uuid REFERENCES public.usuario(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((cardinality(modalidades)>0 OR vendido_em IS NOT NULL) AND modalidades <@ ARRAY['TEMPORADA','LOCACAO','VENDA']::text[]),
 CHECK(jsonb_typeof(endereco)='object' AND jsonb_typeof(endereco_publico)='object' AND jsonb_typeof(caracteristicas)='object')
);
CREATE INDEX imovel_proprietario_idx ON public.imovel(proprietario_id);
CREATE INDEX imovel_publicacao_idx ON public.imovel(publicado,ativo);

CREATE TABLE public.imovel_tarifa (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, imovel_id bigint NOT NULL REFERENCES public.imovel(id),
 inicio date NOT NULL, fim date NOT NULL CHECK(fim>inicio), diaria numeric(14,2) NOT NULL CHECK(diaria>0),
 min_noites integer NOT NULL DEFAULT 1 CHECK(min_noites>0), prioridade integer NOT NULL DEFAULT 0, ativo boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.usuario(id)
);
CREATE INDEX imovel_tarifa_periodo_idx ON public.imovel_tarifa(imovel_id,inicio,fim);

CREATE TABLE public.site_usuario (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 tipo text NOT NULL CHECK(tipo IN ('CLIENTE','PROPRIETARIO')), email text NOT NULL,
 cliente_id integer UNIQUE REFERENCES public.cliente(id), proprietario_id bigint UNIQUE REFERENCES public.proprietario(id),
 status text NOT NULL DEFAULT 'PENDENTE' CHECK(status IN ('PENDENTE','ATIVO','BLOQUEADO')),
 motivo_pendencia text, dados_cadastro jsonb NOT NULL DEFAULT '{}',
 created_by uuid REFERENCES public.usuario(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((tipo='CLIENTE' AND proprietario_id IS NULL) OR (tipo='PROPRIETARIO' AND cliente_id IS NULL)),
 CHECK(status<>'ATIVO' OR (tipo='CLIENTE' AND cliente_id IS NOT NULL) OR (tipo='PROPRIETARIO' AND proprietario_id IS NOT NULL))
);
CREATE UNIQUE INDEX site_usuario_email_uidx ON public.site_usuario(lower(email));

CREATE TABLE public.reserva_imovel (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, imovel_id bigint NOT NULL REFERENCES public.imovel(id),
 cliente_id integer NOT NULL REFERENCES public.cliente(id), proprietario_id bigint NOT NULL REFERENCES public.proprietario(id),
 inicio date NOT NULL, fim date NOT NULL CHECK(fim>inicio), hospedes integer NOT NULL CHECK(hospedes>0),
 status text NOT NULL DEFAULT 'CONFIRMADA' CHECK(status IN ('CONFIRMADA','EM_ANDAMENTO','CONCLUIDA','CANCELADA')),
 origem text NOT NULL DEFAULT 'ERP' CHECK(origem IN ('ERP','SITE')),
 valor_diarias numeric(14,2) NOT NULL CHECK(valor_diarias>=0), taxa_limpeza numeric(14,2) NOT NULL DEFAULT 0 CHECK(taxa_limpeza>=0),
 valor_total numeric(14,2) NOT NULL CHECK(valor_total>0), percentual_admin numeric(5,2) NOT NULL CHECK(percentual_admin BETWEEN 0 AND 100),
 financeiro_status text NOT NULL DEFAULT 'PENDENTE' CHECK(financeiro_status IN ('PENDENTE','PARCIAL','PAGO','ESTORNADO')),
 cotacao_snapshot jsonb NOT NULL DEFAULT '{}', observacoes text, cancelamento_motivo text,
 beneficiario_futuro_id bigint REFERENCES public.proprietario(id), beneficiario_vigencia date, beneficiario_vigencia_fim date,
 idempotency_key text UNIQUE NOT NULL, payload_hash text NOT NULL,
 created_by uuid REFERENCES public.usuario(id), updated_by uuid REFERENCES public.usuario(id), auth_actor_id uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reserva_imovel_cliente_idx ON public.reserva_imovel(cliente_id,inicio);
CREATE INDEX reserva_imovel_imovel_idx ON public.reserva_imovel(imovel_id,inicio,fim);

CREATE TABLE public.locacao_imovel (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, imovel_id bigint NOT NULL REFERENCES public.imovel(id),
 cliente_id integer NOT NULL REFERENCES public.cliente(id), proprietario_id bigint NOT NULL REFERENCES public.proprietario(id),
 inicio date NOT NULL, fim date CHECK(fim>inicio), valor_mensal numeric(14,2) NOT NULL CHECK(valor_mensal>0),
 dia_vencimento integer NOT NULL DEFAULT 5 CHECK(dia_vencimento BETWEEN 1 AND 31),
 indice_reajuste text, proximo_reajuste date, valor_inicial numeric(14,2), reajustes jsonb NOT NULL DEFAULT '[]', percentual_admin numeric(5,2) NOT NULL CHECK(percentual_admin BETWEEN 0 AND 100),
 status text NOT NULL DEFAULT 'ATIVA' CHECK(status IN ('ATIVA','ENCERRADA','CANCELADA')),
 observacoes text, encerramento_motivo text, encerrado_em date,
 beneficiario_futuro_id bigint REFERENCES public.proprietario(id), beneficiario_vigencia date, beneficiario_vigencia_fim date,
 idempotency_key text UNIQUE NOT NULL, payload_hash text NOT NULL,
 created_by uuid REFERENCES public.usuario(id), updated_by uuid REFERENCES public.usuario(id), auth_actor_id uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX locacao_imovel_cliente_idx ON public.locacao_imovel(cliente_id);

CREATE TABLE public.venda_imovel (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, imovel_id bigint NOT NULL REFERENCES public.imovel(id),
 comprador_id integer NOT NULL REFERENCES public.cliente(id), proprietario_id bigint NOT NULL REFERENCES public.proprietario(id),
 data_venda date NOT NULL, valor_total numeric(14,2) NOT NULL CHECK(valor_total>0),
 comissao_percentual numeric(5,2) NOT NULL DEFAULT 0 CHECK(comissao_percentual BETWEEN 0 AND 100),
 comissao_valor numeric(14,2) NOT NULL CHECK(comissao_valor>=0),
 status text NOT NULL DEFAULT 'RASCUNHO' CHECK(status IN ('RASCUNHO','CONCLUIDA','CANCELADA')),
 novo_proprietario_id bigint REFERENCES public.proprietario(id), vigencia_beneficiario date,
 decisoes jsonb NOT NULL DEFAULT '[]', parcelas jsonb NOT NULL DEFAULT '[]', observacoes text,
 idempotency_key text UNIQUE NOT NULL, payload_hash text NOT NULL,
 created_by uuid REFERENCES public.usuario(id), updated_by uuid REFERENCES public.usuario(id), auth_actor_id uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX venda_imovel_concluida_uidx ON public.venda_imovel(imovel_id) WHERE status='CONCLUIDA';

CREATE TABLE public.imovel_ocupacao (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, imovel_id bigint NOT NULL REFERENCES public.imovel(id),
 tipo text NOT NULL CHECK(tipo IN ('RESERVA','LOCACAO','BLOQUEIO','MANUTENCAO')),
 inicio date NOT NULL, fim date CHECK(fim>inicio), periodo daterange GENERATED ALWAYS AS (daterange(inicio,fim,'[)')) STORED,
 ativo boolean NOT NULL DEFAULT true, motivo text, reserva_id bigint UNIQUE REFERENCES public.reserva_imovel(id),
 locacao_id bigint UNIQUE REFERENCES public.locacao_imovel(id), created_by uuid REFERENCES public.usuario(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((tipo='RESERVA' AND reserva_id IS NOT NULL AND locacao_id IS NULL) OR (tipo='LOCACAO' AND locacao_id IS NOT NULL AND reserva_id IS NULL) OR (tipo IN ('BLOQUEIO','MANUTENCAO') AND reserva_id IS NULL AND locacao_id IS NULL)),
 CONSTRAINT imovel_ocupacao_sem_sobreposicao EXCLUDE USING gist (imovel_id WITH =, periodo WITH &&) WHERE (ativo)
);

ALTER TABLE public.transacao
 ADD COLUMN imovel_id bigint REFERENCES public.imovel(id),
 ADD COLUMN proprietario_id bigint REFERENCES public.proprietario(id),
 ADD COLUMN reserva_imovel_id bigint REFERENCES public.reserva_imovel(id),
 ADD COLUMN locacao_imovel_id bigint REFERENCES public.locacao_imovel(id),
 ADD COLUMN venda_imovel_id bigint REFERENCES public.venda_imovel(id),
 ADD COLUMN recurso_terceiros boolean NOT NULL DEFAULT false,
 ADD COLUMN imovel_percentual_admin numeric(5,2) CHECK(imovel_percentual_admin BETWEEN 0 AND 100),
 ADD COLUMN imovel_natureza text CHECK(imovel_natureza IN ('RECEBIMENTO','DESPESA_PROPRIETARIO','REPASSE','COMISSAO','REEMBOLSO')),
 ADD COLUMN imovel_competencia date,
 ADD COLUMN imovel_chave text UNIQUE;
CREATE UNIQUE INDEX transacao_locacao_competencia_uidx ON public.transacao(locacao_imovel_id,imovel_competencia) WHERE baixa_de_transacao_id IS NULL AND imovel_natureza='RECEBIMENTO';
CREATE INDEX transacao_imovel_idx ON public.transacao(imovel_id,proprietario_id);

CREATE TABLE public.imovel_movimento (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, imovel_id bigint NOT NULL REFERENCES public.imovel(id),
 proprietario_id bigint NOT NULL REFERENCES public.proprietario(id), reserva_id bigint REFERENCES public.reserva_imovel(id),
 locacao_id bigint REFERENCES public.locacao_imovel(id), venda_id bigint REFERENCES public.venda_imovel(id),
 transacao_id bigint REFERENCES public.transacao(id) ON DELETE SET NULL, transacao_chave bigint NOT NULL,
 tipo text NOT NULL CHECK(tipo IN ('BRUTO_RECEBIDO','TAXA_ADMIN','DESPESA_PROPRIETARIO','REPASSE')),
 valor numeric(14,2) NOT NULL CHECK(valor<>0), percentual_admin numeric(5,2), competencia_em date NOT NULL,
 data_movimento timestamptz NOT NULL DEFAULT now(), descricao text,
 chave_unica text NOT NULL UNIQUE, nfse_id bigint REFERENCES public.nfse(id),
 created_by uuid REFERENCES public.usuario(id), auth_actor_id uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX imovel_movimento_extrato_idx ON public.imovel_movimento(proprietario_id,data_movimento,imovel_id);
CREATE INDEX imovel_movimento_transacao_idx ON public.imovel_movimento(transacao_chave,tipo);

CREATE TABLE public.imovel_arquivo (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, imovel_id bigint REFERENCES public.imovel(id),
 proprietario_id bigint REFERENCES public.proprietario(id), reserva_id bigint REFERENCES public.reserva_imovel(id),
 locacao_id bigint REFERENCES public.locacao_imovel(id), venda_id bigint REFERENCES public.venda_imovel(id),
 tipo text NOT NULL CHECK(tipo IN ('FOTO','DOCUMENTO')), bucket text NOT NULL,
 path text NOT NULL, nome text NOT NULL, mime text, tamanho bigint CHECK(tamanho>=0), publico boolean NOT NULL DEFAULT false, ordem integer NOT NULL DEFAULT 0,
 created_by uuid REFERENCES public.usuario(id), auth_actor_id uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(bucket,path), CHECK(imovel_id IS NOT NULL OR proprietario_id IS NOT NULL),
 CHECK((tipo='FOTO' AND bucket='imoveis-fotos' AND publico AND imovel_id IS NOT NULL AND reserva_id IS NULL AND locacao_id IS NULL AND venda_id IS NULL) OR (bucket='imoveis-documentos' AND NOT publico))
);
ALTER TABLE public.proprietario ADD COLUMN foto_arquivo_id bigint REFERENCES public.imovel_arquivo(id) ON DELETE SET NULL;
CREATE TABLE public.imovel_lead (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, imovel_id bigint REFERENCES public.imovel(id), cliente_id integer REFERENCES public.cliente(id),
 nome text NOT NULL, email text, telefone text, mensagem text, modalidade text CHECK(modalidade IN ('TEMPORADA','LOCACAO','VENDA','PROPRIETARIO')),
 status text NOT NULL DEFAULT 'NOVO' CHECK(status IN ('NOVO','EM_ATENDIMENTO','CONVERTIDO','ARQUIVADO')),
 responsavel_id uuid REFERENCES public.usuario(id), origem text NOT NULL DEFAULT 'SITE' CHECK(origem IN ('SITE','ERP')),
 idempotency_key text UNIQUE, historico jsonb NOT NULL DEFAULT '[]',
 created_by uuid REFERENCES public.usuario(id), auth_actor_id uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.imovel_visita (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, imovel_id bigint NOT NULL REFERENCES public.imovel(id), cliente_id integer REFERENCES public.cliente(id), lead_id bigint REFERENCES public.imovel_lead(id),
 inicio timestamptz NOT NULL, fim timestamptz NOT NULL CHECK(fim>inicio),
 status text NOT NULL DEFAULT 'SOLICITADA' CHECK(status IN ('SOLICITADA','CONFIRMADA','REALIZADA','CANCELADA')),
 responsavel_id uuid REFERENCES public.usuario(id), observacoes text,
 created_by uuid REFERENCES public.usuario(id), auth_actor_id uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auditoria_evento ADD COLUMN auth_actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.auditoria_evento DROP CONSTRAINT auditoria_evento_origem_check;
ALTER TABLE public.auditoria_evento ADD CONSTRAINT auditoria_evento_origem_check CHECK(origem IN ('usuario','sistema','cliente','proprietario'));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES
 ('imoveis-fotos','imoveis-fotos',true,10485760,ARRAY['image/jpeg','image/png','image/webp']),
 ('imoveis-documentos','imoveis-documentos',false,52428800,ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO NOTHING;

CREATE FUNCTION public.imob_cpf_valido(p_cpf text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE s integer; d integer; j integer; k integer;
BEGIN
 IF p_cpf IS NULL OR p_cpf !~ '^[0-9]{11}$' OR p_cpf=repeat(left(p_cpf,1),11) THEN RETURN false; END IF;
 FOR k IN 10..11 LOOP
  s:=0;
  FOR j IN 1..k-1 LOOP s:=s+substring(p_cpf,j,1)::integer*(k+1-j); END LOOP;
  d:=(s*10)%11; IF d=10 THEN d:=0; END IF;
  IF d<>substring(p_cpf,k,1)::integer THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
ALTER TABLE public.proprietario ADD CONSTRAINT proprietario_cpf_valido CHECK(tipopessoa<>'FISICA' OR public.imob_cpf_valido(cpfcnpj));

CREATE FUNCTION public.imob_preparar_usuario_site() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_cpf text:=regexp_replace(coalesce(new.raw_user_meta_data->>'cpf',''),'[^0-9]','','g');
BEGIN
 -- Ausência de CPF: convites de proprietário e criação interna não viram clientes.
 -- Qualquer tipo/perfil informado pelo próprio usuário é ignorado.
 IF nullif(v_cpf,'') IS NULL THEN RETURN new; END IF;
 INSERT INTO public.site_usuario(user_id,tipo,email,status,motivo_pendencia,dados_cadastro)
 VALUES(new.id,'CLIENTE',lower(new.email),'PENDENTE',CASE WHEN public.imob_cpf_valido(v_cpf) THEN 'EMAIL_NAO_CONFIRMADO' ELSE 'CPF_INVALIDO' END,
 jsonb_build_object('cpf',v_cpf,'nome',left(coalesce(nullif(btrim(new.raw_user_meta_data->>'nome'),''),new.email),150),'telefone',left(coalesce(new.raw_user_meta_data->>'telefone',''),30)))
 ON CONFLICT(user_id) DO NOTHING;
 RETURN new;
END $$;
CREATE TRIGGER imob_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.imob_preparar_usuario_site();

CREATE FUNCTION public.imob_sincronizar_cliente_site(p_auth_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE a record; s public.site_usuario%ROWTYPE; c public.cliente%ROWTYPE; v_cpf text; v_email text; v_id integer; v_motivo text;
BEGIN
 SELECT id,email,email_confirmed_at,raw_user_meta_data INTO a FROM auth.users WHERE id=p_auth_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE='P0002'; END IF;
 SELECT * INTO s FROM public.site_usuario WHERE user_id=p_auth_id FOR UPDATE;
 IF NOT FOUND THEN
  v_cpf:=regexp_replace(coalesce(a.raw_user_meta_data->>'cpf',''),'[^0-9]','','g');
  IF NOT public.imob_cpf_valido(v_cpf) THEN RETURN jsonb_build_object('status','PENDENTE','motivo','CPF_INVALIDO'); END IF;
  INSERT INTO public.site_usuario(user_id,tipo,email,dados_cadastro) VALUES(a.id,'CLIENTE',lower(a.email),jsonb_build_object('cpf',v_cpf,'nome',coalesce(a.raw_user_meta_data->>'nome',a.email),'telefone',a.raw_user_meta_data->>'telefone')) RETURNING * INTO s;
 END IF;
 IF s.tipo<>'CLIENTE' THEN RETURN jsonb_build_object('status',s.status,'tipo',s.tipo); END IF;
 IF s.status='BLOQUEADO' THEN RETURN jsonb_build_object('status','BLOQUEADO'); END IF;
 v_cpf:=s.dados_cadastro->>'cpf'; v_email:=lower(a.email);
 IF a.email_confirmed_at IS NULL THEN v_motivo:='EMAIL_NAO_CONFIRMADO';
 ELSIF NOT public.imob_cpf_valido(v_cpf) THEN v_motivo:='CPF_INVALIDO';
 ELSIF length(btrim(coalesce(s.dados_cadastro->>'nome','')))<2 OR length(btrim(coalesce(s.dados_cadastro->>'nome','')))>150 THEN v_motivo:='NOME_INVALIDO';
 ELSIF length(regexp_replace(coalesce(s.dados_cadastro->>'telefone',''),'[^0-9]','','g'))<8 OR length(coalesce(s.dados_cadastro->>'telefone',''))>30 THEN v_motivo:='TELEFONE_INVALIDO';
 ELSIF EXISTS(SELECT 1 FROM public.usuario WHERE id=a.id) THEN v_motivo:='CONTA_INTERNA';
 ELSIF EXISTS(SELECT 1 FROM public.proprietario p WHERE p.user_id=a.id OR (p.user_id IS NOT NULL AND lower(p.email)=v_email)) THEN v_motivo:='EMAIL_PROPRIETARIO';
 END IF;
 IF v_motivo IS NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('imob-cliente:'||v_cpf,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('imob-email:'||v_email,0));
  SELECT * INTO c FROM public.cliente WHERE cpfcnpj=v_cpf FOR UPDATE;
  IF FOUND THEN
   IF c.is_deleted OR lower(coalesce(c.email,''))<>v_email OR (c.user_id IS NOT NULL AND c.user_id<>a.id) THEN v_motivo:='CADASTRO_DIVERGENTE';
   ELSE v_id:=c.id; UPDATE public.cliente SET user_id=a.id,updatedat=now() WHERE id=v_id; END IF;
  ELSIF EXISTS(SELECT 1 FROM public.cliente WHERE lower(email)=v_email OR user_id=a.id) THEN v_motivo:='CADASTRO_DIVERGENTE';
  ELSE
   INSERT INTO public.cliente(tipopessoa,cpfcnpj,nomerazaosocial,email,telefone,user_id,status)
   VALUES('FISICA',v_cpf,left(coalesce(nullif(btrim(s.dados_cadastro->>'nome'),''),a.email),150),v_email,nullif(s.dados_cadastro->>'telefone',''),a.id,'ATIVO') RETURNING id INTO v_id;
  END IF;
 END IF;
 UPDATE public.site_usuario SET cliente_id=v_id,email=v_email,status=CASE WHEN v_id IS NOT NULL THEN 'ATIVO' ELSE 'PENDENTE' END,motivo_pendencia=v_motivo,updated_at=now() WHERE user_id=a.id;
 RETURN jsonb_build_object('status',CASE WHEN v_id IS NOT NULL THEN 'ATIVO' ELSE 'PENDENTE' END,'tipo','CLIENTE','cliente_id',v_id,'motivo',v_motivo);
END $$;

CREATE FUNCTION public.imob_validar_acesso_site() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE a record;
BEGIN
 SELECT id,email INTO a FROM auth.users WHERE id=new.user_id;
 IF new.tipo='PROPRIETARIO' THEN
  IF new.proprietario_id IS NULL OR new.created_by IS NULL THEN RAISE EXCEPTION 'Acesso de proprietário exige concessão pelo ERP.'; END IF;
  IF EXISTS(SELECT 1 FROM public.cliente c WHERE c.user_id=a.id OR (c.user_id IS NOT NULL AND lower(c.email)=lower(a.email))) OR EXISTS(SELECT 1 FROM public.usuario WHERE id=a.id) THEN RAISE EXCEPTION 'Use e-mail exclusivo para o acesso de proprietário.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.proprietario p WHERE p.id=new.proprietario_id AND p.user_id=a.id) THEN RAISE EXCEPTION 'Proprietário e identidade incompatíveis.'; END IF;
 ELSIF new.proprietario_id IS NOT NULL THEN RAISE EXCEPTION 'Conta de cliente não concede acesso de proprietário.';
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER imob_site_usuario_validar BEFORE INSERT OR UPDATE ON public.site_usuario FOR EACH ROW EXECUTE FUNCTION public.imob_validar_acesso_site();

CREATE FUNCTION public.imob_auditar() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_new jsonb; v_old jsonb; v_actor uuid; v_auth uuid; v_origem text; v_id text;
BEGIN
 v_new:=CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(new) END; v_old:=CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(old) END;
 IF TG_OP='UPDATE' AND v_new=v_old THEN RETURN new; END IF;
 v_actor:=public.auditoria_try_uuid(current_setting('app.audit_user_id',true));
 IF v_actor IS NULL THEN v_actor:=public.auditoria_try_uuid(coalesce(v_new->>'updated_by',v_new->>'created_by',v_old->>'updated_by',v_old->>'created_by')); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.usuario WHERE id=v_actor) THEN v_actor:=NULL; END IF;
 v_auth:=public.auditoria_try_uuid(current_setting('app.imob_auth_actor_id',true));
 IF v_auth IS NULL THEN v_auth:=public.auditoria_try_uuid(coalesce(v_new->>'auth_actor_id',v_old->>'auth_actor_id')); END IF;
 v_origem:=CASE WHEN v_actor IS NOT NULL THEN 'usuario' WHEN v_auth IS NOT NULL THEN coalesce((SELECT lower(tipo) FROM public.site_usuario WHERE user_id=v_auth),'cliente') ELSE 'sistema' END;
 v_id:=coalesce(v_new->>'id',v_old->>'id',v_new->>'user_id',v_old->>'user_id');
 INSERT INTO public.auditoria_evento(operacao,tabela,modulo,registro_id,usuario_id,auth_actor_id,dados_anteriores,dados_novos,origem)
 VALUES(TG_OP,TG_TABLE_NAME,'imobiliario',v_id,v_actor,v_auth,public.auditoria_json_seguro(v_old),public.auditoria_json_seguro(v_new),v_origem);
 RETURN CASE WHEN TG_OP='DELETE' THEN old ELSE new END;
END $$;

CREATE TABLE public.imovel_cotacao (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), imovel_id bigint NOT NULL REFERENCES public.imovel(id),
 snapshot jsonb NOT NULL, expira_em timestamptz NOT NULL DEFAULT (now()+interval '15 minutes'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX imovel_cotacao_expira_idx ON public.imovel_cotacao(expira_em);
CREATE FUNCTION public.imob_cotar_reserva(p_imovel_id bigint,p_inicio date,p_fim date,p_hospedes integer) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i public.imovel%ROWTYPE; v_dia date; v_valor numeric; v_total numeric:=0; v_min integer; v_tarifa record; v_noites integer; v_diarias jsonb:='[]'; v_result jsonb; v_id uuid; v_expira timestamptz:=clock_timestamp()+interval '15 minutes';
BEGIN
 SELECT * INTO i FROM public.imovel WHERE id=p_imovel_id AND ativo;
 IF NOT FOUND OR NOT ('TEMPORADA'=ANY(i.modalidades)) THEN RAISE EXCEPTION 'Imóvel indisponível para temporada.' USING ERRCODE='22023'; END IF;
 IF p_inicio IS NULL OR p_fim IS NULL OR p_fim<=p_inicio OR p_fim-p_inicio>730 OR p_hospedes IS NULL OR p_hospedes<1 OR p_hospedes>i.capacidade THEN RAISE EXCEPTION 'Período ou quantidade de hóspedes inválido.' USING ERRCODE='22023'; END IF;
 v_noites:=p_fim-p_inicio; v_min:=i.min_noites;
 FOR v_dia IN SELECT generate_series(p_inicio::timestamp,(p_fim-1)::timestamp,interval '1 day')::date LOOP
  SELECT diaria,min_noites INTO v_tarifa FROM public.imovel_tarifa WHERE imovel_id=i.id AND ativo AND inicio<=v_dia AND fim>v_dia ORDER BY prioridade DESC,id DESC LIMIT 1;
  IF FOUND THEN v_valor:=v_tarifa.diaria; v_min:=greatest(v_min,v_tarifa.min_noites);
  ELSE v_valor:=i.diaria; END IF;
  IF v_valor<=0 THEN RAISE EXCEPTION 'Diária não configurada para %.',v_dia USING ERRCODE='22023'; END IF;
  v_total:=v_total+v_valor; v_diarias:=v_diarias||jsonb_build_array(jsonb_build_object('data',v_dia,'diaria',v_valor));
 END LOOP;
 IF v_noites<greatest(v_min,i.min_noites) OR (i.max_noites IS NOT NULL AND v_noites>i.max_noites) THEN RAISE EXCEPTION 'Quantidade de noites fora dos limites do imóvel.' USING ERRCODE='22023'; END IF;
 v_result:=jsonb_build_object('imovel_id',i.id,'inicio',p_inicio,'fim',p_fim,'hospedes',p_hospedes,'noites',v_noites,'diarias',v_diarias,'valor_diarias',v_total,'taxa_limpeza',i.taxa_limpeza,'valor_total',v_total+i.taxa_limpeza,'percentual_admin',i.percentual_admin,'disponivel',NOT EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE imovel_id=i.id AND ativo AND periodo&&daterange(p_inicio,p_fim,'[)')),'cotacao_em',clock_timestamp(),'expira_em',v_expira);
 INSERT INTO public.imovel_cotacao(imovel_id,snapshot,expira_em) VALUES(i.id,v_result,v_expira) RETURNING id INTO v_id;
 RETURN v_result||jsonb_build_object('cotacao_id',v_id);
END $$;

CREATE FUNCTION public.imob_definir_ator(p_actor uuid) RETURNS uuid LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM set_config('app.audit_user_id','',true);
 PERFORM set_config('app.imob_auth_actor_id','',true);
 IF p_actor IS NULL THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.usuario WHERE id=p_actor AND ativo) THEN
  PERFORM set_config('app.audit_user_id',p_actor::text,true); RETURN p_actor;
 END IF;
 IF EXISTS(SELECT 1 FROM public.site_usuario WHERE user_id=p_actor AND status='ATIVO') THEN
  PERFORM set_config('app.imob_auth_actor_id',p_actor::text,true); RETURN NULL;
 END IF;
 RAISE EXCEPTION 'Ator sem acesso ativo.' USING ERRCODE='42501';
END $$;

CREATE OR REPLACE FUNCTION public.transacao_gera_evento_de_resultado(p_transacao_id bigint) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.transacao%ROWTYPE; v_exclui boolean;
BEGIN
 SELECT * INTO t FROM public.transacao WHERE id=p_transacao_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF t.recurso_terceiros OR t.imovel_natureza='COMISSAO' OR t.is_deleted OR t.evento_financeiro_id IS NOT NULL OR t.lancamento_id IS NOT NULL
 OR t.pagamento_multiplo_id IS NOT NULL OR t.baixa_de_transacao_id IS NOT NULL OR t.ordemservicoid IS NOT NULL
 OR t.vendaid IS NOT NULL OR t.entrada_id IS NOT NULL OR t.usoconsumo_entrada_id IS NOT NULL
 OR t.origem='ORIGEM_MIGRACAO' OR t.eh_adiantamento OR t.adiantamento_id IS NOT NULL
 OR t.transferencia_id IS NOT NULL OR t.tipo::text IN ('SAQUE','DEPOSITO') THEN RETURN false; END IF;
 SELECT d.situacao='EXCLUIDO' INTO v_exclui FROM public.dre_destino_do_cadastro(t.plano_de_conta_id,NULL,coalesce(t.competencia_em,t.data)::date) d;
 RETURN NOT coalesce(v_exclui,false);
END $$;
ALTER TABLE public.eventos_financeiros DROP CONSTRAINT eventos_financeiros_source_type_check;
ALTER TABLE public.eventos_financeiros ADD CONSTRAINT eventos_financeiros_source_type_check CHECK(source_type IS NULL OR source_type IN ('ORDEM_SERVICO','VENDA','TRANSACAO','MANUAL','ENTRADA','USOCONSUMO_ENTRADA','IMOVEL_TAXA'));
ALTER TABLE public.eventos_financeiros DROP CONSTRAINT eventos_financeiros_origem_check;
ALTER TABLE public.eventos_financeiros ADD CONSTRAINT eventos_financeiros_origem_check CHECK(origem IN ('PRODUTO','SERVICO','COMISSAO','AVULSO','DESCONTO','FRETE','ENTRADA_FISCAL','CONSUMO','ADMINISTRACAO_IMOBILIARIA','ESTORNO_ADMINISTRACAO_IMOBILIARIA','COMISSAO_IMOBILIARIA'));

CREATE FUNCTION public.imob_preparar_transacao() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p public.transacao%ROWTYPE; v_saldo numeric; v_delta numeric;
BEGIN
 IF new.baixa_de_transacao_id IS NOT NULL THEN
  SELECT * INTO p FROM public.transacao WHERE id=new.baixa_de_transacao_id;
  IF p.imovel_id IS NOT NULL THEN
   new.imovel_id:=p.imovel_id; new.proprietario_id:=p.proprietario_id; new.reserva_imovel_id:=p.reserva_imovel_id;
   new.locacao_imovel_id:=p.locacao_imovel_id; new.venda_imovel_id:=p.venda_imovel_id;
   new.recurso_terceiros:=p.recurso_terceiros; new.imovel_percentual_admin:=p.imovel_percentual_admin;
   new.imovel_natureza:=p.imovel_natureza; new.imovel_competencia:=p.imovel_competencia;
  END IF;
 END IF;
 IF new.imovel_id IS NOT NULL AND (new.proprietario_id IS NULL OR new.imovel_natureza IS NULL) THEN RAISE EXCEPTION 'Transação imobiliária exige proprietário e natureza.'; END IF;
 IF new.imovel_natureza IN ('RECEBIMENTO','DESPESA_PROPRIETARIO','REPASSE','REEMBOLSO') AND NOT new.recurso_terceiros THEN RAISE EXCEPTION 'Recursos do proprietário devem ser segregados do resultado.'; END IF;
 IF TG_OP='UPDATE' AND old.imovel_id IS NOT NULL AND (new.imovel_id,new.proprietario_id,new.reserva_imovel_id,new.locacao_imovel_id,new.venda_imovel_id,new.imovel_percentual_admin,new.imovel_natureza,new.recurso_terceiros) IS DISTINCT FROM (old.imovel_id,old.proprietario_id,old.reserva_imovel_id,old.locacao_imovel_id,old.venda_imovel_id,old.imovel_percentual_admin,old.imovel_natureza,old.recurso_terceiros)
 AND (NOT old.pendente OR old.valor_baixado>0 OR EXISTS(SELECT 1 FROM public.imovel_movimento WHERE transacao_chave=old.id)) THEN RAISE EXCEPTION 'Vínculos e percentual de transação recebida são históricos e imutáveis.'; END IF;
 IF new.imovel_natureza='REPASSE' AND NOT new.pendente AND NOT new.is_deleted AND NOT new.abonado AND new.banco_id IS NOT NULL AND new.pago_em IS NOT NULL THEN
  PERFORM 1 FROM public.proprietario WHERE id=new.proprietario_id FOR UPDATE;
  SELECT coalesce(nullif(new."valorLiquido",0),new.valor)-coalesce(sum(valor),0) INTO v_delta FROM public.imovel_movimento WHERE transacao_chave=new.id AND tipo='REPASSE';
  SELECT coalesce(sum(CASE WHEN tipo='BRUTO_RECEBIDO' THEN valor ELSE -valor END),0) INTO v_saldo FROM public.imovel_movimento WHERE proprietario_id=new.proprietario_id AND imovel_id=new.imovel_id;
  IF v_delta>0 AND v_delta>v_saldo THEN RAISE EXCEPTION 'Pagamento do repasse excede o saldo recebido e disponível.' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER a_imob_transacao_preparar BEFORE INSERT OR UPDATE ON public.transacao FOR EACH ROW EXECUTE FUNCTION public.imob_preparar_transacao();

CREATE FUNCTION public.imob_sincronizar_movimento(p_tx public.transacao,p_excluida boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_valor numeric(14,2):=0; v_taxa numeric(14,2):=0; v_tipo text; v_alvo numeric(14,2); v_atual numeric(14,2); v_delta numeric(14,2); v_mov_id bigint; v_total numeric; v_r public.reserva_imovel%ROWTYPE; v_actor uuid; v_prop bigint; v_benef bigint; v_de date; v_ate date; v_base bigint; v_evento bigint; v_template integer; v_origem text; v_evento_valor numeric;
BEGIN
 IF p_tx.imovel_id IS NULL OR p_tx.proprietario_id IS NULL THEN RETURN; END IF;
 -- Uma trava por transação elimina dupla contabilização entre triggers encadeados.
 PERFORM pg_advisory_xact_lock(hashtextextended('imob-caixa:'||p_tx.id,0));
 SELECT proprietario_id INTO v_prop FROM public.imovel_movimento WHERE transacao_chave=p_tx.id ORDER BY id LIMIT 1;
 IF v_prop IS NULL THEN
  IF p_tx.reserva_imovel_id IS NOT NULL THEN SELECT proprietario_id,beneficiario_futuro_id,beneficiario_vigencia,beneficiario_vigencia_fim INTO v_base,v_benef,v_de,v_ate FROM public.reserva_imovel WHERE id=p_tx.reserva_imovel_id;
  ELSIF p_tx.locacao_imovel_id IS NOT NULL THEN SELECT proprietario_id,beneficiario_futuro_id,beneficiario_vigencia,beneficiario_vigencia_fim INTO v_base,v_benef,v_de,v_ate FROM public.locacao_imovel WHERE id=p_tx.locacao_imovel_id; END IF;
  v_prop:=CASE WHEN v_benef IS NOT NULL AND p_tx.pago_em::date>=v_de AND (v_ate IS NULL OR p_tx.pago_em::date<v_ate) THEN v_benef ELSE coalesce(v_base,p_tx.proprietario_id) END;
 END IF;
 IF NOT p_excluida AND NOT p_tx.is_deleted AND NOT p_tx.pendente AND NOT p_tx.abonado AND p_tx.banco_id IS NOT NULL AND p_tx.pago_em IS NOT NULL THEN
  v_valor:=round(coalesce(nullif(p_tx."valorLiquido",0),p_tx.valor),2);
 END IF;
 v_taxa:=CASE WHEN p_tx.imovel_natureza IN ('RECEBIMENTO','REEMBOLSO') THEN round(v_valor*coalesce(p_tx.imovel_percentual_admin,0)/100,2)*CASE WHEN p_tx.imovel_natureza='REEMBOLSO' THEN -1 ELSE 1 END ELSE 0 END;
 v_actor:=coalesce(p_tx.baixado_por,p_tx.updated_by,p_tx.created_by);
 FOR v_tipo,v_alvo IN SELECT * FROM (VALUES
  ('BRUTO_RECEBIDO'::text,CASE WHEN p_tx.imovel_natureza='RECEBIMENTO' THEN v_valor WHEN p_tx.imovel_natureza='REEMBOLSO' THEN -v_valor ELSE 0 END),
  ('TAXA_ADMIN',v_taxa),('DESPESA_PROPRIETARIO',CASE WHEN p_tx.imovel_natureza='DESPESA_PROPRIETARIO' THEN v_valor ELSE 0 END),
  ('REPASSE',CASE WHEN p_tx.imovel_natureza='REPASSE' THEN v_valor ELSE 0 END)) z(tipo,alvo)
 LOOP
  SELECT coalesce(sum(valor),0) INTO v_atual FROM public.imovel_movimento WHERE transacao_chave=p_tx.id AND tipo=v_tipo;
  v_delta:=round(v_alvo-v_atual,2);
  IF v_delta<>0 THEN
   INSERT INTO public.imovel_movimento(imovel_id,proprietario_id,reserva_id,locacao_id,venda_id,transacao_id,transacao_chave,tipo,valor,percentual_admin,competencia_em,data_movimento,descricao,chave_unica,created_by,auth_actor_id)
   VALUES(p_tx.imovel_id,v_prop,p_tx.reserva_imovel_id,p_tx.locacao_imovel_id,p_tx.venda_imovel_id,CASE WHEN p_excluida THEN NULL ELSE p_tx.id END,p_tx.id,v_tipo,v_delta,p_tx.imovel_percentual_admin,coalesce(p_tx.imovel_competencia,p_tx.competencia_em::date,p_tx.data::date,current_date),CASE WHEN v_delta<0 THEN clock_timestamp() ELSE coalesce(p_tx.pago_em,clock_timestamp()) END,CASE WHEN v_delta<0 THEN 'Estorno: ' ELSE '' END||coalesce(p_tx.descricao,''),gen_random_uuid()::text,v_actor,public.auditoria_try_uuid(current_setting('app.imob_auth_actor_id',true))) RETURNING id INTO v_mov_id;
  END IF;
 END LOOP;
 -- Só a taxa recebida pertence à imobiliária. Bruto, despesas do dono e repasse não geram DRE.
 IF p_tx.imovel_natureza IN ('RECEBIMENTO','REEMBOLSO','COMISSAO') THEN
  v_origem:=CASE p_tx.imovel_natureza WHEN 'REEMBOLSO' THEN 'ESTORNO_ADMINISTRACAO_IMOBILIARIA' WHEN 'COMISSAO' THEN 'COMISSAO_IMOBILIARIA' ELSE 'ADMINISTRACAO_IMOBILIARIA' END;
  v_evento_valor:=CASE WHEN p_tx.imovel_natureza='COMISSAO' THEN v_valor ELSE abs(v_taxa) END;
  SELECT id INTO v_template FROM public.dre_template WHERE ativo ORDER BY versao DESC,id DESC LIMIT 1;
  INSERT INTO public.eventos_financeiros(source_type,source_id,origem,natureza,natureza_dre,chave_origem,descricao,valor,data_evento,competencia_em,percentual_snapshot,valor_base_snapshot,dados_snapshot,status,pode_gerar_transacao,created_by)
  VALUES('IMOVEL_TAXA',p_tx.id,v_origem,CASE WHEN p_tx.imovel_natureza='REEMBOLSO' THEN 'DESPESA' ELSE 'RECEITA' END,CASE WHEN p_tx.imovel_natureza='REEMBOLSO' THEN 'DEDUCAO' ELSE 'RECEITA' END,'TAXA_ADMIN','Receita administrativa: '||coalesce(p_tx.descricao,''),v_evento_valor,coalesce(p_tx.pago_em,now()),coalesce(p_tx.pago_em,now()),p_tx.imovel_percentual_admin,v_valor,jsonb_build_object('imovel_id',p_tx.imovel_id,'proprietario_id',v_prop,'reserva_id',p_tx.reserva_imovel_id,'locacao_id',p_tx.locacao_imovel_id),CASE WHEN v_evento_valor>0 THEN 'ATIVO' ELSE 'CANCELADO' END,false,v_actor)
  ON CONFLICT(source_type,source_id,origem,chave_origem,natureza) WHERE ordemservicoid IS NULL
  DO UPDATE SET valor=excluded.valor,valor_base_snapshot=excluded.valor_base_snapshot,status=excluded.status,data_evento=excluded.data_evento,competencia_em=excluded.competencia_em,dados_snapshot=excluded.dados_snapshot,updated_at=now() RETURNING id INTO v_evento;
  IF v_template IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.eventos_financeiros_classificacao WHERE evento_id=v_evento AND template_id=v_template AND vigente) THEN
   PERFORM public.dre_gravar_classificacao_evento(v_evento,v_template,v_actor,NULL);
  END IF;
 END IF;
 IF p_tx.reserva_imovel_id IS NOT NULL THEN
  SELECT * INTO v_r FROM public.reserva_imovel WHERE id=p_tx.reserva_imovel_id FOR UPDATE;
  SELECT coalesce(sum(valor),0) INTO v_total FROM public.imovel_movimento WHERE reserva_id=v_r.id AND tipo='BRUTO_RECEBIDO';
  UPDATE public.reserva_imovel SET financeiro_status=CASE WHEN v_total>=valor_total THEN 'PAGO' WHEN v_total>0 THEN 'PARCIAL' WHEN EXISTS(SELECT 1 FROM public.imovel_movimento WHERE reserva_id=v_r.id AND tipo='BRUTO_RECEBIDO') THEN 'ESTORNADO' ELSE 'PENDENTE' END WHERE id=v_r.id;
 END IF;
END $$;

CREATE FUNCTION public.imob_tratar_cancelamento(p_reserva_id bigint,p_locacao_id bigint,p_tratamento text,p_actor uuid,p_pendentes text DEFAULT 'MANTER') RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_recebido numeric; t public.transacao%ROWTYPE; v_chave text;
BEGIN
 IF p_tratamento NOT IN ('MANTER','ESTORNAR','CREDITO') OR p_tratamento IS NULL THEN RAISE EXCEPTION 'Escolha o tratamento financeiro: MANTER, ESTORNAR ou CREDITO.'; END IF;
 IF p_pendentes NOT IN ('MANTER','CANCELAR_PENDENTES') OR p_pendentes IS NULL THEN RAISE EXCEPTION 'Escolha o tratamento das cobranças pendentes.'; END IF;
 SELECT coalesce(sum(valor),0) INTO v_recebido FROM public.imovel_movimento WHERE tipo='BRUTO_RECEBIDO' AND ((p_reserva_id IS NOT NULL AND reserva_id=p_reserva_id) OR (p_locacao_id IS NOT NULL AND locacao_id=p_locacao_id));
 IF p_tratamento='CREDITO' AND v_recebido>0 THEN RAISE EXCEPTION 'Converta o valor em crédito pelo Financeiro antes de concluir; o cancelamento não movimenta a carteira automaticamente.' USING ERRCODE='22023'; END IF;
 IF v_recebido>0 AND p_tratamento='ESTORNAR' THEN
  SELECT * INTO t FROM public.transacao WHERE baixa_de_transacao_id IS NULL AND imovel_natureza='RECEBIMENTO' AND ((p_reserva_id IS NOT NULL AND reserva_imovel_id=p_reserva_id) OR (p_locacao_id IS NOT NULL AND locacao_imovel_id=p_locacao_id)) ORDER BY id LIMIT 1;
  v_chave:='REEMBOLSO:'||CASE WHEN p_reserva_id IS NOT NULL THEN 'RESERVA:'||p_reserva_id ELSE 'LOCACAO:'||p_locacao_id END;
  PERFORM public.imob_criar_titulo(t.imovel_id,t.proprietario_id,t.cliente_id,v_recebido,current_date,t.imovel_percentual_admin,v_chave,'Reembolso manual de cancelamento',p_actor,p_reserva_id,p_locacao_id,NULL,'REEMBOLSO');
 END IF;
 -- Apenas o saldo a receber é retirado da fila; pagamentos e razão permanecem.
 IF p_pendentes='CANCELAR_PENDENTES' THEN
  UPDATE public.transacao SET is_deleted=true,deleted_at=now(),deleted_by=p_actor WHERE pendente AND baixa_de_transacao_id IS NULL AND imovel_natureza='RECEBIMENTO' AND ((p_reserva_id IS NOT NULL AND reserva_imovel_id=p_reserva_id) OR (p_locacao_id IS NOT NULL AND locacao_imovel_id=p_locacao_id));
 END IF;
END $$;

CREATE FUNCTION public.imob_salvar_reserva(p_payload jsonb,p_actor uuid,p_id bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i public.imovel%ROWTYPE; r public.reserva_imovel%ROWTYPE; q jsonb; v_cot public.imovel_cotacao%ROWTYPE; v_actor uuid; v_hash text:=md5(p_payload::text); v_key text:=nullif(p_payload->>'idempotency_key',''); v_origem text:=coalesce(p_payload->>'origem','ERP'); v_inicio date:=(p_payload->>'inicio')::date; v_fim date:=(p_payload->>'fim')::date; v_hosp integer:=(p_payload->>'hospedes')::integer; v_cliente integer:=(p_payload->>'cliente_id')::integer;
BEGIN
 v_actor:=public.imob_definir_ator(p_actor);
 IF p_id IS NULL AND v_key IS NULL THEN RAISE EXCEPTION 'Chave de idempotência obrigatória.'; END IF;
 IF p_id IS NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('reserva-key:'||v_key,0));
  SELECT * INTO r FROM public.reserva_imovel WHERE idempotency_key=v_key;
  IF FOUND THEN IF r.payload_hash<>v_hash THEN RAISE EXCEPTION 'Chave de idempotência reutilizada com outros dados.' USING ERRCODE='23505'; END IF; RETURN to_jsonb(r); END IF;
 ELSE
  SELECT * INTO r FROM public.reserva_imovel WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada.' USING ERRCODE='P0002'; END IF;
  IF r.status<>'CONFIRMADA' OR EXISTS(SELECT 1 FROM public.imovel_movimento WHERE reserva_id=r.id) THEN RAISE EXCEPTION 'Reserva iniciada ou com movimentos financeiros não pode ter período e valores reescritos.'; END IF;
 END IF;
 SELECT * INTO i FROM public.imovel WHERE id=(p_payload->>'imovel_id')::bigint AND ativo FOR UPDATE;
 IF NOT FOUND OR NOT ('TEMPORADA'=ANY(i.modalidades)) THEN RAISE EXCEPTION 'Imóvel indisponível para temporada.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cliente WHERE id=v_cliente AND NOT is_deleted AND status='ATIVO' AND cpfcnpj IS NOT NULL) THEN RAISE EXCEPTION 'Cliente ativo com documento é obrigatório.'; END IF;
 IF v_origem='SITE' AND v_actor IS NULL THEN
  IF NOT i.publicado OR NOT EXISTS(SELECT 1 FROM public.site_usuario WHERE user_id=p_actor AND tipo='CLIENTE' AND status='ATIVO' AND cliente_id=v_cliente) THEN RAISE EXCEPTION 'Conta sem autorização para a reserva.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_cot FROM public.imovel_cotacao WHERE id=(p_payload->>'cotacao_id')::uuid AND expira_em>clock_timestamp();
  IF NOT FOUND OR v_cot.imovel_id<>i.id OR (v_cot.snapshot->>'inicio')::date<>v_inicio OR (v_cot.snapshot->>'fim')::date<>v_fim OR (v_cot.snapshot->>'hospedes')::integer<>v_hosp THEN RAISE EXCEPTION 'Cotação expirada ou incompatível; consulte novamente.' USING ERRCODE='22023'; END IF;
  q:=public.imob_cotar_reserva(i.id,v_inicio,v_fim,v_hosp);
  IF q->'diarias' IS DISTINCT FROM v_cot.snapshot->'diarias' OR q->'valor_total' IS DISTINCT FROM v_cot.snapshot->'valor_total' OR q->'taxa_limpeza' IS DISTINCT FROM v_cot.snapshot->'taxa_limpeza' THEN RAISE EXCEPTION 'A tarifa mudou; confirme a nova cotação.' USING ERRCODE='22023'; END IF;
 ELSE
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Reserva ERP exige operador interno.' USING ERRCODE='42501'; END IF;
  q:=public.imob_cotar_reserva(i.id,v_inicio,v_fim,v_hosp);
 END IF;
 IF p_payload->>'expected_total' IS NOT NULL AND (p_payload->>'expected_total')::numeric<>(q->>'valor_total')::numeric THEN RAISE EXCEPTION 'O valor da cotação mudou; consulte novamente.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE imovel_id=i.id AND ativo AND periodo&&daterange(v_inicio,v_fim,'[)') AND (p_id IS NULL OR reserva_id IS DISTINCT FROM p_id)) THEN RAISE EXCEPTION 'O imóvel já está ocupado neste período.' USING ERRCODE='23P01'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.reserva_imovel(imovel_id,cliente_id,proprietario_id,inicio,fim,hospedes,origem,valor_diarias,taxa_limpeza,valor_total,percentual_admin,cotacao_snapshot,observacoes,idempotency_key,payload_hash,created_by,auth_actor_id)
  VALUES(i.id,v_cliente,i.proprietario_id,v_inicio,v_fim,v_hosp,v_origem,(q->>'valor_diarias')::numeric,(q->>'taxa_limpeza')::numeric,(q->>'valor_total')::numeric,(q->>'percentual_admin')::numeric,q,p_payload->>'observacoes',v_key,v_hash,v_actor,CASE WHEN v_actor IS NULL THEN p_actor END) RETURNING * INTO r;
 ELSE
  IF v_cliente<>r.cliente_id THEN RAISE EXCEPTION 'Cliente da reserva é imutável.'; END IF;
  UPDATE public.reserva_imovel SET imovel_id=i.id,proprietario_id=i.proprietario_id,inicio=v_inicio,fim=v_fim,hospedes=v_hosp,valor_diarias=(q->>'valor_diarias')::numeric,taxa_limpeza=(q->>'taxa_limpeza')::numeric,valor_total=(q->>'valor_total')::numeric,percentual_admin=(q->>'percentual_admin')::numeric,cotacao_snapshot=q,observacoes=p_payload->>'observacoes',updated_by=v_actor,updated_at=now() WHERE id=r.id RETURNING * INTO r;
  UPDATE public.transacao SET imovel_id=i.id,proprietario_id=i.proprietario_id,imovel_percentual_admin=r.percentual_admin,valor=r.valor_total,"valorLiquido"=r.valor_total,data=r.inicio::timestamptz,vencimento_em=r.inicio::timestamptz,descricao='Reserva #'||r.id||' - '||i.titulo WHERE reserva_imovel_id=r.id AND imovel_natureza='RECEBIMENTO' AND baixa_de_transacao_id IS NULL AND pendente;
 END IF;
 INSERT INTO public.imovel_ocupacao(imovel_id,tipo,inicio,fim,reserva_id,created_by) VALUES(i.id,'RESERVA',r.inicio,r.fim,r.id,v_actor)
 ON CONFLICT(reserva_id) DO UPDATE SET imovel_id=excluded.imovel_id,inicio=excluded.inicio,fim=excluded.fim,ativo=true,updated_at=now();
 PERFORM public.imob_criar_titulo(i.id,r.proprietario_id,v_cliente,r.valor_total,r.inicio,r.percentual_admin,'RESERVA:'||r.id,'Reserva #'||r.id||' - '||i.titulo,v_actor,r.id);
 RETURN to_jsonb(r);
END $$;

CREATE FUNCTION public.imob_acao_reserva(p_id bigint,p_acao text,p_payload jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.reserva_imovel%ROWTYPE; v_actor uuid; v_acao text:=upper(p_acao);
BEGIN
 v_actor:=public.imob_definir_ator(p_actor);
 SELECT * INTO r FROM public.reserva_imovel WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada.' USING ERRCODE='P0002'; END IF;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Ações da reserva são exclusivas do ERP.' USING ERRCODE='42501'; END IF;
 IF v_acao='CONFIRMAR' AND r.status='CONFIRMADA' THEN RETURN to_jsonb(r);
 ELSIF v_acao IN ('CHECKIN','CHECK_IN') THEN
  IF r.status='EM_ANDAMENTO' THEN RETURN to_jsonb(r); END IF;
  IF r.status<>'CONFIRMADA' THEN RAISE EXCEPTION 'Check-in exige reserva confirmada.'; END IF;
  UPDATE public.reserva_imovel SET status='EM_ANDAMENTO' WHERE id=p_id;
 ELSIF v_acao IN ('CHECKOUT','CHECK_OUT','CONCLUIR') THEN
  IF r.status='CONCLUIDA' THEN RETURN to_jsonb(r); END IF;
  IF r.status<>'EM_ANDAMENTO' THEN RAISE EXCEPTION 'Check-out exige check-in registrado.'; END IF;
  UPDATE public.reserva_imovel SET status='CONCLUIDA' WHERE id=p_id;
 ELSIF v_acao='CANCELAR' THEN
  IF r.status='CANCELADA' THEN RETURN to_jsonb(r); END IF;
  IF r.status='CONCLUIDA' THEN RAISE EXCEPTION 'Reserva concluída não pode ser cancelada.'; END IF;
  IF nullif(btrim(p_payload->>'motivo'),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.'; END IF;
  IF v_actor IS NULL AND coalesce(p_payload->>'tratamento_financeiro','MANTER')<>'MANTER' THEN RAISE EXCEPTION 'Tratamento financeiro exige operador ERP.'; END IF;
  IF v_actor IS NOT NULL AND EXISTS(SELECT 1 FROM public.transacao WHERE reserva_imovel_id=r.id AND pendente AND NOT is_deleted AND baixa_de_transacao_id IS NULL) AND p_payload->>'tratamento_pendentes' IS NULL THEN RAISE EXCEPTION 'Escolha como tratar as cobranças pendentes.'; END IF;
  PERFORM public.imob_tratar_cancelamento(r.id,NULL,coalesce(p_payload->>'tratamento_recebidos',p_payload->>'tratamento_financeiro','MANTER'),v_actor,coalesce(p_payload->>'tratamento_pendentes','MANTER'));
  UPDATE public.reserva_imovel SET status='CANCELADA',cancelamento_motivo=p_payload->>'motivo' WHERE id=p_id;
  UPDATE public.imovel_ocupacao SET ativo=false,updated_at=now() WHERE reserva_id=p_id;
 ELSE RAISE EXCEPTION 'Ação de reserva inválida.'; END IF;
 UPDATE public.reserva_imovel SET updated_by=v_actor,updated_at=now() WHERE id=p_id RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION public.imob_transacao_movimento() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN PERFORM public.imob_sincronizar_movimento(old,true); RETURN old; END IF;
 PERFORM public.imob_sincronizar_movimento(new,false); RETURN new;
END $$;
CREATE TRIGGER z_imob_transacao_movimento AFTER INSERT OR UPDATE OR DELETE ON public.transacao FOR EACH ROW EXECUTE FUNCTION public.imob_transacao_movimento();

CREATE FUNCTION public.imob_movimento_imutavel() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(new)-'nfse_id'-'transacao_id')=(to_jsonb(old)-'nfse_id'-'transacao_id') AND (new.transacao_id=old.transacao_id OR new.transacao_id IS NULL) THEN RETURN new; END IF;
 RAISE EXCEPTION 'Movimentos imobiliários são históricos; registre estorno pelo financeiro.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER imob_movimento_proteger BEFORE UPDATE OR DELETE ON public.imovel_movimento FOR EACH ROW EXECUTE FUNCTION public.imob_movimento_imutavel();

CREATE FUNCTION public.imob_gerar_cobrancas_locacao(p_id bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE l public.locacao_imovel%ROWTYPE; v_mes date; v_limite date; v_venc date; v_ultimo date; v_prop bigint; v_id bigint; v_count integer:=0; v_existia boolean; v_valor numeric;
BEGIN
 FOR l IN SELECT * FROM public.locacao_imovel WHERE (status='ATIVA' OR (status='ENCERRADA' AND encerrado_em>current_date)) AND (p_id IS NULL OR id=p_id) ORDER BY id FOR UPDATE LOOP
  v_mes:=date_trunc('month',l.inicio)::date;
  -- Cron mantém mês atual e próximo; contrato futuro tem a primeira cobrança criada no cadastro.
  v_limite:=greatest(v_mes,(date_trunc('month',current_date)+interval '1 month')::date);
  IF l.fim IS NOT NULL THEN v_limite:=least(v_limite,date_trunc('month',l.fim-1)::date); END IF;
  IF l.encerrado_em IS NOT NULL THEN v_limite:=least(v_limite,date_trunc('month',l.encerrado_em-1)::date); END IF;
  IF v_limite-v_mes>36600 THEN RAISE EXCEPTION 'Contrato excede limite de geração de 100 anos.'; END IF;
  WHILE v_mes<=v_limite LOOP
   v_ultimo:=(v_mes+interval '1 month - 1 day')::date;
   v_venc:=greatest(l.inicio,v_mes+(least(l.dia_vencimento,extract(day FROM v_ultimo)::integer)-1));
   v_prop:=CASE WHEN l.beneficiario_futuro_id IS NOT NULL AND v_venc>=l.beneficiario_vigencia AND (l.beneficiario_vigencia_fim IS NULL OR v_venc<l.beneficiario_vigencia_fim) THEN l.beneficiario_futuro_id ELSE l.proprietario_id END;
   SELECT EXISTS(SELECT 1 FROM public.transacao WHERE imovel_chave='LOCACAO:'||l.id||':'||v_mes) INTO v_existia;
   SELECT (r->>'valor')::numeric INTO v_valor FROM jsonb_array_elements(l.reajustes) r WHERE (r->>'inicio')::date<=v_venc ORDER BY (r->>'inicio')::date DESC LIMIT 1;
   v_valor:=coalesce(v_valor,l.valor_inicial,l.valor_mensal);
   v_id:=public.imob_criar_titulo(l.imovel_id,v_prop,l.cliente_id,v_valor,v_venc,l.percentual_admin,'LOCACAO:'||l.id||':'||v_mes,'Aluguel #'||l.id||' - '||to_char(v_mes,'MM/YYYY'),l.created_by,NULL,l.id);
   IF NOT v_existia THEN v_count:=v_count+1; END IF;
   v_mes:=(v_mes+interval '1 month')::date;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('geradas',v_count);
END $$;

CREATE FUNCTION public.imob_salvar_locacao(p_payload jsonb,p_actor uuid,p_id bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i public.imovel%ROWTYPE; l public.locacao_imovel%ROWTYPE; v_actor uuid; v_key text:=nullif(p_payload->>'idempotency_key',''); v_hash text:=md5(p_payload::text); v_inicio date:=(p_payload->>'inicio')::date; v_fim date:=(p_payload->>'fim')::date; v_cliente integer:=(p_payload->>'cliente_id')::integer;
BEGIN
 v_actor:=public.imob_definir_ator(p_actor); IF v_actor IS NULL THEN RAISE EXCEPTION 'Locação exige operador ERP.' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL THEN
  IF v_key IS NULL THEN RAISE EXCEPTION 'Chave de idempotência obrigatória.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('locacao-key:'||v_key,0));
  SELECT * INTO l FROM public.locacao_imovel WHERE idempotency_key=v_key;
  IF FOUND THEN IF l.payload_hash<>v_hash THEN RAISE EXCEPTION 'Chave de idempotência reutilizada com outros dados.' USING ERRCODE='23505'; END IF; RETURN to_jsonb(l); END IF;
 ELSE
  SELECT * INTO l FROM public.locacao_imovel WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Locação não encontrada.' USING ERRCODE='P0002'; END IF;
  IF l.status<>'ATIVA' THEN RAISE EXCEPTION 'Contrato encerrado não pode ser alterado.'; END IF;
  IF l.imovel_id<>(p_payload->>'imovel_id')::bigint OR l.cliente_id<>v_cliente OR l.inicio<>v_inicio THEN RAISE EXCEPTION 'Imóvel, cliente e início são históricos; encerre o contrato para substituir.'; END IF;
  IF l.valor_mensal<>(p_payload->>'valor_mensal')::numeric THEN RAISE EXCEPTION 'Use a ação de reajuste para alterar o aluguel.'; END IF;
 END IF;
 SELECT * INTO i FROM public.imovel WHERE id=(p_payload->>'imovel_id')::bigint AND ativo FOR UPDATE;
 IF NOT FOUND OR NOT ('LOCACAO'=ANY(i.modalidades)) THEN RAISE EXCEPTION 'Imóvel indisponível para locação.'; END IF;
 IF v_inicio IS NULL OR (v_fim IS NOT NULL AND v_fim<=v_inicio) THEN RAISE EXCEPTION 'Período inválido.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cliente WHERE id=v_cliente AND NOT is_deleted AND status='ATIVO' AND cpfcnpj IS NOT NULL) THEN RAISE EXCEPTION 'Cliente ativo com documento é obrigatório.'; END IF;
 IF EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE imovel_id=i.id AND ativo AND periodo&&daterange(v_inicio,v_fim,'[)') AND (p_id IS NULL OR locacao_id IS DISTINCT FROM p_id)) THEN RAISE EXCEPTION 'O imóvel já está ocupado neste período.' USING ERRCODE='23P01'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.locacao_imovel(imovel_id,cliente_id,proprietario_id,inicio,fim,valor_mensal,dia_vencimento,indice_reajuste,proximo_reajuste,percentual_admin,observacoes,idempotency_key,payload_hash,created_by)
  VALUES(i.id,v_cliente,i.proprietario_id,v_inicio,v_fim,(p_payload->>'valor_mensal')::numeric,coalesce((p_payload->>'dia_vencimento')::integer,5),p_payload->>'indice_reajuste',(p_payload->>'proximo_reajuste')::date,coalesce((p_payload->>'percentual_admin')::numeric,i.percentual_admin),p_payload->>'observacoes',v_key,v_hash,v_actor) RETURNING * INTO l;
 ELSE
  UPDATE public.locacao_imovel SET fim=v_fim,dia_vencimento=coalesce((p_payload->>'dia_vencimento')::integer,dia_vencimento),indice_reajuste=p_payload->>'indice_reajuste',proximo_reajuste=(p_payload->>'proximo_reajuste')::date,observacoes=p_payload->>'observacoes',updated_by=v_actor,updated_at=now() WHERE id=p_id RETURNING * INTO l;
 END IF;
 INSERT INTO public.imovel_ocupacao(imovel_id,tipo,inicio,fim,locacao_id,created_by) VALUES(i.id,'LOCACAO',l.inicio,l.fim,l.id,v_actor)
 ON CONFLICT(locacao_id) DO UPDATE SET inicio=excluded.inicio,fim=excluded.fim,ativo=true,updated_at=now();
 PERFORM public.imob_gerar_cobrancas_locacao(l.id);
 RETURN to_jsonb(l);
END $$;

CREATE FUNCTION public.imob_acao_locacao(p_id bigint,p_acao text,p_payload jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE l public.locacao_imovel%ROWTYPE; v_actor uuid; v_acao text:=upper(p_acao); v_fim date; v_valor numeric; v_inicio date;
BEGIN
 v_actor:=public.imob_definir_ator(p_actor); IF v_actor IS NULL THEN RAISE EXCEPTION 'Ação exclusiva ERP.' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.locacao_imovel WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Locação não encontrada.' USING ERRCODE='P0002'; END IF;
 IF v_acao='GERAR_COBRANCAS' THEN RETURN public.imob_gerar_cobrancas_locacao(l.id); END IF;
 IF v_acao IN ('ENCERRAR','CANCELAR') THEN
  IF l.status IN ('ENCERRADA','CANCELADA') THEN RETURN to_jsonb(l); END IF;
  v_fim:=coalesce((p_payload->>'fim')::date,(p_payload->>'encerrado_em')::date,current_date);
  IF v_fim<=l.inicio THEN v_fim:=l.inicio+1; END IF;
  IF nullif(btrim(p_payload->>'motivo'),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo do encerramento.'; END IF;
  IF EXISTS(SELECT 1 FROM public.transacao WHERE locacao_imovel_id=l.id AND pendente AND NOT is_deleted AND baixa_de_transacao_id IS NULL) AND p_payload->>'tratamento_pendentes' IS NULL THEN RAISE EXCEPTION 'Escolha o tratamento das cobranças pendentes.'; END IF;
  PERFORM public.imob_tratar_cancelamento(NULL,l.id,coalesce(p_payload->>'tratamento_recebidos',p_payload->>'tratamento_financeiro','MANTER'),v_actor,coalesce(p_payload->>'tratamento_pendentes','MANTER'));
  UPDATE public.locacao_imovel SET status=CASE WHEN v_acao='ENCERRAR' THEN 'ENCERRADA' ELSE 'CANCELADA' END,encerrado_em=v_fim,encerramento_motivo=p_payload->>'motivo',updated_by=v_actor,updated_at=now() WHERE id=p_id RETURNING * INTO l;
  IF v_acao='CANCELAR' OR v_fim<=current_date THEN UPDATE public.imovel_ocupacao SET ativo=false,updated_at=now() WHERE locacao_id=l.id;
  ELSE UPDATE public.imovel_ocupacao SET fim=v_fim,updated_at=now() WHERE locacao_id=l.id; END IF;
 ELSIF v_acao='REAJUSTAR' THEN
  IF l.status<>'ATIVA' THEN RAISE EXCEPTION 'Reajuste exige contrato ativo.'; END IF;
  v_valor:=coalesce((p_payload->>'valor_mensal')::numeric,round(l.valor_mensal*(1+(p_payload->>'percentual')::numeric/100),2));
  v_inicio:=coalesce((p_payload->>'inicio')::date,current_date);
  IF v_valor IS NULL OR v_valor<=0 OR v_inicio<current_date THEN RAISE EXCEPTION 'Valor ou vigência de reajuste inválido.'; END IF;
  -- Recebidos permanecem com o valor original. Pendentes a partir da vigência acompanham reajuste.
  UPDATE public.transacao SET valor=v_valor,"valorLiquido"=v_valor,updated_by=v_actor,updated_at=now() WHERE locacao_imovel_id=l.id AND baixa_de_transacao_id IS NULL AND imovel_natureza='RECEBIMENTO' AND pendente AND valor_baixado=0 AND NOT is_deleted AND vencimento_em::date>=v_inicio;
  UPDATE public.locacao_imovel SET valor_inicial=coalesce(valor_inicial,valor_mensal),valor_mensal=v_valor,reajustes=(SELECT coalesce(jsonb_agg(r),'[]') FROM jsonb_array_elements(reajustes) r WHERE r->>'inicio'<>v_inicio::text)||jsonb_build_array(jsonb_build_object('inicio',v_inicio,'valor',v_valor,'anterior',l.valor_mensal,'ator',v_actor)),proximo_reajuste=(p_payload->>'proximo_reajuste')::date,updated_by=v_actor,updated_at=now() WHERE id=l.id RETURNING * INTO l;
 ELSE RAISE EXCEPTION 'Ação de locação inválida.'; END IF;
 RETURN to_jsonb(l);
END $$;

CREATE FUNCTION public.imob_criar_titulo(p_imovel_id bigint,p_proprietario_id bigint,p_cliente_id integer,p_valor numeric,p_vencimento date,p_percentual numeric,p_chave text,p_descricao text,p_actor uuid,p_reserva_id bigint DEFAULT NULL,p_locacao_id bigint DEFAULT NULL,p_venda_id bigint DEFAULT NULL,p_natureza text DEFAULT 'RECEBIMENTO') RETURNS bigint LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_id bigint;
BEGIN
 INSERT INTO public.transacao(descricao,valor,valor_base,"valorLiquido",data,vencimento_em,competencia_em,tipo,pendente,cliente_id,nomepagador,cpfcnpjpagador,imovel_id,proprietario_id,reserva_imovel_id,locacao_imovel_id,venda_imovel_id,recurso_terceiros,imovel_percentual_admin,imovel_natureza,imovel_competencia,imovel_chave,origem,created_by)
 VALUES(p_descricao,p_valor,p_valor,p_valor,p_vencimento::timestamptz,p_vencimento::timestamptz,p_vencimento::timestamptz,CASE WHEN p_natureza IN ('RECEBIMENTO','COMISSAO') THEN 'RECEITA'::public.tipos_transacao ELSE 'DESPESA'::public.tipos_transacao END,true,p_cliente_id,coalesce((SELECT nomerazaosocial FROM public.cliente WHERE id=p_cliente_id),(SELECT nomerazaosocial FROM public.proprietario WHERE id=p_proprietario_id)),coalesce((SELECT cpfcnpj FROM public.cliente WHERE id=p_cliente_id),(SELECT cpfcnpj FROM public.proprietario WHERE id=p_proprietario_id)),p_imovel_id,p_proprietario_id,p_reserva_id,p_locacao_id,p_venda_id,p_natureza<>'COMISSAO',p_percentual,p_natureza,date_trunc('month',p_vencimento)::date,p_chave,'IMOBILIARIO',p_actor)
 ON CONFLICT(imovel_chave) DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN SELECT id INTO v_id FROM public.transacao WHERE imovel_chave=p_chave; END IF;
 RETURN v_id;
END $$;

CREATE FUNCTION public.imob_salvar_venda(p_payload jsonb,p_actor uuid,p_id bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i public.imovel%ROWTYPE; v public.venda_imovel%ROWTYPE; v_actor uuid; v_key text:=nullif(p_payload->>'idempotency_key',''); v_hash text:=md5(p_payload::text); v_total numeric:=(p_payload->>'valor_total')::numeric; v_pct numeric:=coalesce((p_payload->>'comissao_percentual')::numeric,0);
BEGIN
 v_actor:=public.imob_definir_ator(p_actor); IF v_actor IS NULL THEN RAISE EXCEPTION 'Venda exige operador ERP.' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL THEN
  IF v_key IS NULL THEN RAISE EXCEPTION 'Chave de idempotência obrigatória.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('venda-key:'||v_key,0));
  SELECT * INTO v FROM public.venda_imovel WHERE idempotency_key=v_key;
  IF FOUND THEN IF v.payload_hash<>v_hash THEN RAISE EXCEPTION 'Chave de idempotência reutilizada com outros dados.' USING ERRCODE='23505'; END IF; RETURN to_jsonb(v); END IF;
 ELSE
  SELECT * INTO v FROM public.venda_imovel WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE='P0002'; END IF;
  IF v.status<>'RASCUNHO' THEN RAISE EXCEPTION 'Venda concluída não pode ser reescrita.'; END IF;
 END IF;
 SELECT * INTO i FROM public.imovel WHERE id=(p_payload->>'imovel_id')::bigint AND ativo FOR UPDATE;
 IF NOT FOUND OR i.vendido_em IS NOT NULL OR NOT ('VENDA'=ANY(i.modalidades)) THEN RAISE EXCEPTION 'Imóvel indisponível para venda.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cliente WHERE id=(p_payload->>'comprador_id')::integer AND NOT is_deleted AND status='ATIVO' AND cpfcnpj IS NOT NULL) THEN RAISE EXCEPTION 'Comprador ativo com documento é obrigatório.'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.venda_imovel(imovel_id,comprador_id,proprietario_id,data_venda,valor_total,comissao_percentual,comissao_valor,novo_proprietario_id,vigencia_beneficiario,decisoes,parcelas,observacoes,idempotency_key,payload_hash,created_by)
  VALUES(i.id,(p_payload->>'comprador_id')::integer,i.proprietario_id,(p_payload->>'data_venda')::date,v_total,v_pct,coalesce((p_payload->>'comissao_valor')::numeric,round(v_total*v_pct/100,2)),(p_payload->>'novo_proprietario_id')::bigint,(p_payload->>'vigencia_beneficiario')::date,coalesce(p_payload->'operacoes',p_payload->'decisoes','[]'),coalesce(p_payload->'parcelas','[]'),p_payload->>'observacoes',v_key,v_hash,v_actor) RETURNING * INTO v;
 ELSE
  IF i.id<>v.imovel_id THEN RAISE EXCEPTION 'Imóvel da venda é imutável.'; END IF;
  UPDATE public.venda_imovel SET comprador_id=(p_payload->>'comprador_id')::integer,data_venda=(p_payload->>'data_venda')::date,valor_total=v_total,comissao_percentual=v_pct,comissao_valor=coalesce((p_payload->>'comissao_valor')::numeric,round(v_total*v_pct/100,2)),novo_proprietario_id=(p_payload->>'novo_proprietario_id')::bigint,vigencia_beneficiario=(p_payload->>'vigencia_beneficiario')::date,decisoes=coalesce(p_payload->'operacoes',p_payload->'decisoes','[]'),parcelas=coalesce(p_payload->'parcelas',parcelas),observacoes=p_payload->>'observacoes',updated_by=v_actor,updated_at=now() WHERE id=p_id RETURNING * INTO v;
 END IF;
 RETURN to_jsonb(v);
END $$;

CREATE FUNCTION public.imob_acao_venda(p_id bigint,p_acao text,p_payload jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v public.venda_imovel%ROWTYPE; i public.imovel%ROWTYPE; r record; d jsonb; ds jsonb; ps jsonb; v_actor uuid; v_acao text:=upper(p_acao); v_prop bigint; v_inicio date; v_fim date; v_count integer; v_parcela integer:=0;
BEGIN
 v_actor:=public.imob_definir_ator(p_actor); IF v_actor IS NULL THEN RAISE EXCEPTION 'Ação exclusiva ERP.' USING ERRCODE='42501'; END IF;
 SELECT * INTO v FROM public.venda_imovel WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE='P0002'; END IF;
 SELECT * INTO i FROM public.imovel WHERE id=v.imovel_id FOR UPDATE;
 IF v_acao='CANCELAR' THEN
  IF v.status='CANCELADA' THEN RETURN to_jsonb(v); END IF;
  IF v.status<>'RASCUNHO' THEN RAISE EXCEPTION 'Venda concluída exige reversão contratual e financeira pelo operador; não pode ser cancelada automaticamente.'; END IF;
  UPDATE public.venda_imovel SET status='CANCELADA',updated_by=v_actor,updated_at=now() WHERE id=p_id RETURNING * INTO v; RETURN to_jsonb(v);
 END IF;
 IF v_acao NOT IN ('CONCLUIR','CONFIRMAR','FINALIZAR') THEN RAISE EXCEPTION 'Ação de venda inválida.'; END IF;
 IF v.status='CONCLUIDA' THEN RETURN to_jsonb(v); END IF;
 IF v.status<>'RASCUNHO' OR i.vendido_em IS NOT NULL THEN RAISE EXCEPTION 'Venda indisponível para conclusão.'; END IF;
 ps:=coalesce(p_payload->'parcelas',v.parcelas);
 IF ps='[]'::jsonb THEN ps:=jsonb_build_array(jsonb_build_object('valor',v.valor_total,'vencimento',v.data_venda)); END IF;
 IF jsonb_typeof(ps)<>'array' OR jsonb_array_length(ps)>120 OR jsonb_array_length(ps)=0 THEN RAISE EXCEPTION 'Parcelamento da venda inválido.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(ps) x WHERE (x->>'valor')::numeric IS NULL OR (x->>'valor')::numeric<=0 OR nullif(x->>'vencimento','') IS NULL) OR (SELECT round(sum((x->>'valor')::numeric),2) FROM jsonb_array_elements(ps) x)<>v.valor_total THEN RAISE EXCEPTION 'Parcelas devem somar exatamente o valor da venda.'; END IF;
 ds:=coalesce(p_payload->'operacoes',p_payload->'decisoes',v.decisoes);
 IF jsonb_typeof(ds)<>'array' THEN RAISE EXCEPTION 'Informe as decisões por operação.'; END IF;
 FOR r IN
  SELECT 'RESERVA'::text AS tipo,id,inicio,fim FROM public.reserva_imovel WHERE imovel_id=i.id AND status IN ('CONFIRMADA','EM_ANDAMENTO') AND fim>v.data_venda
  UNION ALL SELECT 'LOCACAO',id,inicio,fim FROM public.locacao_imovel WHERE imovel_id=i.id AND status='ATIVA' AND (fim IS NULL OR fim>v.data_venda)
 LOOP
  SELECT count(*) INTO v_count FROM jsonb_array_elements(ds) x WHERE upper(x->>'tipo')=r.tipo AND (x->>'id')::bigint=r.id;
  IF v_count<>1 THEN RAISE EXCEPTION 'Escolha exatamente uma decisão para % #%.',r.tipo,r.id; END IF;
  SELECT x INTO d FROM jsonb_array_elements(ds) x WHERE upper(x->>'tipo')=r.tipo AND (x->>'id')::bigint=r.id;
  IF upper(d->>'decisao')='MANTER' THEN
   v_prop:=(d->>'beneficiario_proprietario_id')::bigint; v_inicio:=(d->>'vigencia_inicio')::date; v_fim:=(d->>'vigencia_fim')::date;
   IF v_prop IS NULL OR v_inicio IS NULL OR v_inicio<v.data_venda OR NOT EXISTS(SELECT 1 FROM public.proprietario WHERE id=v_prop AND ativo) OR (v_fim IS NOT NULL AND v_fim<=v_inicio) THEN RAISE EXCEPTION 'Manter operação exige beneficiário ativo e vigência futura válida.'; END IF;
   IF r.tipo='RESERVA' THEN UPDATE public.reserva_imovel SET beneficiario_futuro_id=v_prop,beneficiario_vigencia=v_inicio,beneficiario_vigencia_fim=v_fim,updated_by=v_actor,updated_at=now() WHERE id=r.id;
   ELSE UPDATE public.locacao_imovel SET beneficiario_futuro_id=v_prop,beneficiario_vigencia=v_inicio,beneficiario_vigencia_fim=v_fim,updated_by=v_actor,updated_at=now() WHERE id=r.id; END IF;
  ELSIF upper(d->>'decisao')='ENCERRAR' THEN
   IF coalesce(d->>'tratamento_recebidos',d->>'tratamento_financeiro') IS NULL OR d->>'tratamento_pendentes' IS NULL THEN RAISE EXCEPTION 'Encerrar operação exige tratamento explícito de pendentes e recebidos.'; END IF;
   IF r.tipo='RESERVA' THEN PERFORM public.imob_acao_reserva(r.id,'CANCELAR',d||jsonb_build_object('motivo','Encerramento pela venda #'||v.id),v_actor);
   ELSE PERFORM public.imob_acao_locacao(r.id,'ENCERRAR',d||jsonb_build_object('motivo','Encerramento pela venda #'||v.id,'fim',v.data_venda),v_actor); END IF;
  ELSE RAISE EXCEPTION 'Decisão inválida para % #%.',r.tipo,r.id;
  END IF;
 END LOOP;
 UPDATE public.venda_imovel SET status='CONCLUIDA',decisoes=ds,parcelas=ps,novo_proprietario_id=coalesce((p_payload->>'novo_proprietario_id')::bigint,novo_proprietario_id),vigencia_beneficiario=coalesce((p_payload->>'vigencia_beneficiario')::date,vigencia_beneficiario),updated_by=v_actor,updated_at=now() WHERE id=v.id RETURNING * INTO v;
 UPDATE public.imovel SET vendido_em=v.data_venda,modalidades=array_remove(modalidades,'VENDA'),proprietario_id=coalesce(v.novo_proprietario_id,proprietario_id),publicado=CASE WHEN cardinality(array_remove(modalidades,'VENDA'))=0 THEN false ELSE publicado END,updated_by=v_actor,updated_at=now() WHERE id=i.id;
 IF v.comissao_valor>0 THEN PERFORM public.imob_criar_titulo(i.id,v.proprietario_id,NULL,v.comissao_valor,v.data_venda,0,'VENDA-COMISSAO:'||v.id,'Comissão da venda #'||v.id,v_actor,NULL,NULL,v.id,'COMISSAO'); END IF;
 FOR d IN SELECT x FROM jsonb_array_elements(ps) x LOOP
  v_parcela:=v_parcela+1;
  PERFORM public.imob_criar_titulo(i.id,v.proprietario_id,v.comprador_id,(d->>'valor')::numeric,(d->>'vencimento')::date,0,'VENDA:'||v.id||':PARCELA:'||v_parcela,'Venda #'||v.id||' - Parcela '||v_parcela||'/'||jsonb_array_length(ps),v_actor,NULL,NULL,v.id,'RECEBIMENTO');
 END LOOP;
 RETURN to_jsonb(v);
END $$;

CREATE FUNCTION public.imob_registrar_repasse(p_payload jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_actor uuid; v_prop bigint:=(p_payload->>'proprietario_id')::bigint; v_imovel bigint:=(p_payload->>'imovel_id')::bigint; v_valor numeric:=(p_payload->>'valor')::numeric; v_tipo text:=CASE WHEN upper(coalesce(p_payload->>'tipo','REPASSE')) IN ('DESPESA','DESPESA_PROPRIETARIO') THEN 'DESPESA_PROPRIETARIO' ELSE 'REPASSE' END; v_saldo numeric; v_pendente numeric; v_id bigint; v_key text:=nullif(p_payload->>'idempotency_key',''); t public.transacao%ROWTYPE;
BEGIN
 v_actor:=public.imob_definir_ator(p_actor); IF v_actor IS NULL THEN RAISE EXCEPTION 'Ação exclusiva ERP.' USING ERRCODE='42501'; END IF;
 IF v_key IS NULL OR v_valor IS NULL OR v_valor<=0 THEN RAISE EXCEPTION 'Informe valor positivo e chave de idempotência.'; END IF;
 PERFORM 1 FROM public.proprietario WHERE id=v_prop AND ativo FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Proprietário inexistente ou inativo.'; END IF;
 SELECT * INTO t FROM public.transacao WHERE imovel_chave=v_tipo||':'||v_key;
 IF FOUND THEN
  IF t.imovel_id<>v_imovel OR t.proprietario_id<>v_prop OR t.valor<>v_valor THEN RAISE EXCEPTION 'Chave de idempotência reutilizada com outros dados.' USING ERRCODE='23505'; END IF;
  RETURN to_jsonb(t);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.imovel WHERE id=v_imovel AND (proprietario_id=v_prop OR EXISTS(SELECT 1 FROM public.imovel_movimento WHERE imovel_id=v_imovel AND proprietario_id=v_prop))) THEN RAISE EXCEPTION 'Imóvel não pertence ao proprietário informado.'; END IF;
 IF v_tipo='REPASSE' THEN
  SELECT coalesce(sum(CASE WHEN tipo='BRUTO_RECEBIDO' THEN valor ELSE -valor END),0) INTO v_saldo FROM public.imovel_movimento WHERE proprietario_id=v_prop AND imovel_id=v_imovel;
  SELECT coalesce(sum(greatest(coalesce(nullif("valorLiquido",0),valor)-valor_baixado,0)),0) INTO v_pendente FROM public.transacao WHERE proprietario_id=v_prop AND imovel_id=v_imovel AND imovel_natureza='REPASSE' AND pendente AND NOT is_deleted AND baixa_de_transacao_id IS NULL;
  IF v_valor>v_saldo-v_pendente THEN RAISE EXCEPTION 'Repasse excede o saldo disponível do proprietário.' USING ERRCODE='22023'; END IF;
 END IF;
 v_id:=public.imob_criar_titulo(v_imovel,v_prop,NULL,v_valor,coalesce((p_payload->>'vencimento')::date,current_date),0,v_tipo||':'||v_key,coalesce(p_payload->>'descricao',CASE WHEN v_tipo='REPASSE' THEN 'Repasse ao proprietário' ELSE 'Despesa do proprietário' END),v_actor,NULL,NULL,NULL,v_tipo);
 IF p_payload->>'banco_id' IS NOT NULL THEN
  PERFORM public.baixar_transacao_pendente(v_id,coalesce((p_payload->>'pago_em')::timestamptz,now()),(p_payload->>'banco_id')::bigint,coalesce(p_payload->>'metodopagamento','TRANSFERENCIA'),NULL,NULL,v_actor);
 END IF;
 SELECT * INTO t FROM public.transacao WHERE id=v_id; RETURN to_jsonb(t);
END $$;

ALTER TABLE public.transacao ADD COLUMN imovel_nfse_id bigint REFERENCES public.nfse(id) ON DELETE RESTRICT;
CREATE TABLE public.imovel_nfse_origem (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, nfse_id bigint NOT NULL REFERENCES public.nfse(id) ON DELETE RESTRICT,
 movimento_id bigint UNIQUE REFERENCES public.imovel_movimento(id), transacao_id bigint UNIQUE REFERENCES public.transacao(id) ON DELETE RESTRICT,
 proprietario_id bigint NOT NULL REFERENCES public.proprietario(id), imovel_id bigint NOT NULL REFERENCES public.imovel(id),
 valor numeric(14,2) NOT NULL CHECK(valor>0), created_by uuid REFERENCES public.usuario(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((movimento_id IS NOT NULL)::integer+(transacao_id IS NOT NULL)::integer=1)
);
CREATE FUNCTION public.imob_reservar_nfse(p_movimento_ids bigint[],p_transacao_ids bigint[],p_empresa_id integer,p_payload jsonb,p_modelo text,p_referencia text,p_actor uuid,p_reemitir boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_actor uuid; v_prop bigint; v_props integer; v_count integer; v_n integer; v_existing bigint; v_existing_count integer; v_ids bigint[]:=coalesce(p_movimento_ids,'{}'); v_txids bigint[]:=coalesce(p_transacao_ids,'{}'); v_total numeric; v_informado numeric; v_doc text; v_nfse public.nfse%ROWTYPE; v_itens jsonb;
BEGIN
 v_actor:=public.imob_definir_ator(p_actor); IF v_actor IS NULL THEN RAISE EXCEPTION 'Emissão exige operador ERP.' USING ERRCODE='42501'; END IF;
 v_n:=cardinality(v_ids)+cardinality(v_txids);
 IF v_n=0 OR v_n>200 OR (SELECT count(DISTINCT x) FROM unnest(v_ids) x)<>cardinality(v_ids) OR (SELECT count(DISTINCT x) FROM unnest(v_txids) x)<>cardinality(v_txids) THEN RAISE EXCEPTION 'Selecione fontes administrativas distintas.'; END IF;
 PERFORM 1 FROM public.imovel_movimento WHERE id=ANY(v_ids) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.transacao WHERE id=ANY(v_txids) ORDER BY id FOR UPDATE;
 SELECT count(*),count(DISTINCT nfse_id),min(nfse_id) INTO v_count,v_existing_count,v_existing FROM public.imovel_nfse_origem WHERE movimento_id=ANY(v_ids) OR transacao_id=ANY(v_txids);
 IF v_count>0 THEN
  IF v_existing_count<>1 OR v_count<>v_n THEN RAISE EXCEPTION 'Seleção mistura fontes já faturadas e novas; consulte a nota existente.'; END IF;
  SELECT * INTO v_nfse FROM public.nfse WHERE id=v_existing FOR UPDATE;
  IF v_nfse.empresaid<>p_empresa_id THEN RAISE EXCEPTION 'Fontes já vinculadas a outra empresa emissora.'; END IF;
  IF NOT p_reemitir THEN RETURN jsonb_build_object('id',v_nfse.id,'referencia',v_nfse.referencia,'already_exists',true,'status',v_nfse.status,'valor_total',v_nfse.valor_total,'proprietario_id',(SELECT proprietario_id FROM public.imovel_nfse_origem WHERE nfse_id=v_existing LIMIT 1)); END IF;
  IF upper(v_nfse.status)<>'REJEITADA' OR nullif(v_nfse.numero,'') IS NOT NULL OR nullif(v_nfse.protocolo,'') IS NOT NULL OR nullif(v_nfse.url_xml,'') IS NOT NULL THEN RAISE EXCEPTION 'Nova tentativa exige rejeição confirmada sem documento autorizado.'; END IF;
  IF (SELECT count(*) FROM public.imovel_nfse_origem WHERE nfse_id=v_existing)<>v_n THEN RAISE EXCEPTION 'Nova tentativa deve conservar todas as fontes originais.'; END IF;
 ELSIF p_reemitir THEN RAISE EXCEPTION 'Não existe nota rejeitada para essas fontes.';
 END IF;
 IF (SELECT count(*) FROM public.imovel_movimento WHERE id=ANY(v_ids) AND tipo='TAXA_ADMIN' AND valor>0 AND (nfse_id IS NULL OR nfse_id=v_existing))<>cardinality(v_ids) THEN RAISE EXCEPTION 'Somente taxas administrativas positivas e recebidas podem ser faturadas.'; END IF;
 IF (SELECT count(*) FROM public.transacao WHERE id=ANY(v_txids) AND imovel_natureza='COMISSAO' AND NOT is_deleted AND NOT pendente AND NOT abonado AND (imovel_nfse_id IS NULL OR imovel_nfse_id=v_existing))<>cardinality(v_txids) THEN RAISE EXCEPTION 'Somente comissões de venda recebidas podem ser faturadas.'; END IF;
 IF EXISTS(SELECT 1 FROM public.imovel_movimento m WHERE m.id=ANY(v_ids) GROUP BY m.transacao_chave HAVING sum(m.valor)>(SELECT coalesce(sum(x.valor),0) FROM public.imovel_movimento x WHERE x.transacao_chave=m.transacao_chave AND x.tipo='TAXA_ADMIN')) THEN RAISE EXCEPTION 'Taxa foi estornada; selecione apenas valores efetivamente recebidos.'; END IF;
 SELECT count(DISTINCT proprietario_id),min(proprietario_id),round(sum(valor),2),jsonb_agg(item) INTO v_props,v_prop,v_total,v_itens FROM (
  SELECT m.proprietario_id,m.valor,jsonb_build_object('tipo','TAXA_ADMIN','movimento_id',m.id,'imovel_id',m.imovel_id,'valor',m.valor) AS item FROM public.imovel_movimento m WHERE m.id=ANY(v_ids)
  UNION ALL SELECT t.proprietario_id,coalesce(nullif(t."valorLiquido",0),t.valor),jsonb_build_object('tipo','COMISSAO','transacao_id',t.id,'imovel_id',t.imovel_id,'valor',coalesce(nullif(t."valorLiquido",0),t.valor)) FROM public.transacao t WHERE t.id=ANY(v_txids)
 ) z;
 IF v_props<>1 THEN RAISE EXCEPTION 'Uma NFS-e deve ter um único proprietário tomador.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.empresa WHERE id=p_empresa_id) THEN RAISE EXCEPTION 'Empresa emissora não encontrada.'; END IF;
 SELECT cpfcnpj INTO v_doc FROM public.proprietario WHERE id=v_prop FOR UPDATE;
 IF coalesce(p_payload->>'cpf_tomador',p_payload->>'cnpj_tomador',p_payload->'tomador'->>'cpf',p_payload->'tomador'->>'cnpj','')<>v_doc THEN RAISE EXCEPTION 'Tomador da NFS-e deve corresponder ao proprietário das fontes.'; END IF;
 v_informado:=coalesce((p_payload->>'valor_servico')::numeric,(p_payload->'servico'->>'valor_servicos')::numeric);
 IF v_informado IS NULL OR round(v_informado,2)<>v_total OR v_total<=0 THEN RAISE EXCEPTION 'Valor fiscal diverge das receitas administrativas selecionadas.'; END IF;
 IF nullif(p_referencia,'') IS NULL THEN RAISE EXCEPTION 'Referência fiscal obrigatória.'; END IF;
 IF v_existing IS NULL THEN
  INSERT INTO public.nfse(empresaid,clienteid,status,referencia,valor_total,modelo_emissao,servico_ids,itens,payload_enviado)
  VALUES(p_empresa_id,NULL,'PROCESSANDO',p_referencia,v_total,p_modelo,ARRAY[]::integer[],v_itens,p_payload) RETURNING * INTO v_nfse;
  INSERT INTO public.imovel_nfse_origem(nfse_id,movimento_id,proprietario_id,imovel_id,valor,created_by) SELECT v_nfse.id,id,proprietario_id,imovel_id,valor,v_actor FROM public.imovel_movimento WHERE id=ANY(v_ids);
  INSERT INTO public.imovel_nfse_origem(nfse_id,transacao_id,proprietario_id,imovel_id,valor,created_by) SELECT v_nfse.id,id,proprietario_id,imovel_id,coalesce(nullif("valorLiquido",0),valor),v_actor FROM public.transacao WHERE id=ANY(v_txids);
 ELSE
  UPDATE public.nfse SET tentativas=tentativas||jsonb_build_array(jsonb_build_object('data',clock_timestamp(),'referencia',referencia,'status',status,'payload',payload_enviado,'erros',erros)),status='PROCESSANDO',referencia=p_referencia,valor_total=v_total,modelo_emissao=p_modelo,itens=v_itens,payload_enviado=p_payload,erros=NULL,updatedat=now() WHERE id=v_existing RETURNING * INTO v_nfse;
 END IF;
 UPDATE public.imovel_movimento SET nfse_id=v_nfse.id WHERE id=ANY(v_ids);
 UPDATE public.transacao SET imovel_nfse_id=v_nfse.id WHERE id=ANY(v_txids);
 RETURN jsonb_build_object('id',v_nfse.id,'referencia',v_nfse.referencia,'already_exists',false,'status',v_nfse.status,'valor_total',v_total,'proprietario_id',v_prop);
END $$;

CREATE VIEW public.imovel_resumo WITH(security_invoker=true) AS
 SELECT i.*,
 CASE WHEN NOT i.ativo THEN 'INATIVO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.tipo='MANUTENCAO' AND o.periodo @> current_date) THEN 'MANUTENCAO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.tipo='LOCACAO' AND o.periodo @> current_date) THEN 'ALUGADO'
  WHEN EXISTS(SELECT 1 FROM public.reserva_imovel r WHERE r.imovel_id=i.id AND r.status='EM_ANDAMENTO' AND daterange(r.inicio,r.fim,'[)') @> current_date) THEN 'OCUPADO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.periodo @> current_date) THEN 'RESERVADO'
  ELSE 'DISPONIVEL' END::text AS situacao_operacional,
 CASE WHEN i.vendido_em IS NOT NULL THEN 'VENDIDO'
  WHEN EXISTS(SELECT 1 FROM public.venda_imovel v WHERE v.imovel_id=i.id AND v.status='RASCUNHO') OR EXISTS(SELECT 1 FROM public.imovel_lead l WHERE l.imovel_id=i.id AND l.modalidade='VENDA' AND l.status='EM_ATENDIMENTO') THEN 'EM_NEGOCIACAO'
  ELSE 'DISPONIVEL' END::text AS situacao_comercial
 FROM public.imovel i;
REVOKE ALL ON public.imovel_resumo FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.imovel_resumo TO service_role;

-- Somente as colunas necessárias para conferência da identidade; Auth nunca é exposto pela Data API.
GRANT SELECT(id,email,email_confirmed_at,raw_user_meta_data) ON auth.users TO service_role;

CREATE FUNCTION public.imob_atualizar_perfil_cliente(p_auth_id uuid,p_nome text,p_telefone text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_id integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_auth_id AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Confirme o e-mail da conta.' USING ERRCODE='42501'; END IF;
 SELECT cliente_id INTO v_id FROM public.site_usuario WHERE user_id=p_auth_id AND tipo='CLIENTE' AND status='ATIVO';
 IF v_id IS NULL THEN RAISE EXCEPTION 'Conta de cliente sem acesso ativo.' USING ERRCODE='42501'; END IF;
 IF p_nome IS NULL OR length(btrim(p_nome))<2 OR length(p_nome)>150 OR length(coalesce(p_telefone,''))>30 THEN RAISE EXCEPTION 'Nome ou telefone inválido.' USING ERRCODE='22023'; END IF;
 PERFORM set_config('app.imob_auth_actor_id',p_auth_id::text,true);
 UPDATE public.cliente SET nomerazaosocial=btrim(p_nome),telefone=nullif(btrim(p_telefone),''),updatedat=now() WHERE id=v_id AND user_id=p_auth_id AND NOT is_deleted;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cadastro de cliente indisponível.'; END IF;
 INSERT INTO public.auditoria_evento(operacao,tabela,modulo,registro_id,auth_actor_id,origem,dados_novos) VALUES('UPDATE','cliente','imobiliario',v_id::text,p_auth_id,'cliente',jsonb_build_object('nomerazaosocial',btrim(p_nome),'telefone',p_telefone));
 RETURN jsonb_build_object('cliente_id',v_id,'nome',btrim(p_nome),'telefone',p_telefone);
END $$;

-- Definições imob_* são APIs de servidor: autenticação/autorização é feita no ERP/BFF.
-- Invoker não eleva privilégios; RLS fecha acesso direto pelo navegador.
DO $$
DECLARE v_table text; v_function record;
BEGIN
 FOREACH v_table IN ARRAY ARRAY['proprietario','imovel','imovel_tarifa','site_usuario','reserva_imovel','locacao_imovel','venda_imovel','imovel_ocupacao','imovel_movimento','imovel_arquivo','imovel_lead','imovel_visita','imovel_cotacao','imovel_nfse_origem'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',v_table);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',v_table);
  IF v_table<>'imovel_cotacao' THEN EXECUTE format('CREATE TRIGGER imob_auditoria AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.imob_auditar()',v_table); END IF;
  IF v_table<>'site_usuario' AND v_table<>'imovel_cotacao' THEN EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC,anon,authenticated',v_table||'_id_seq'); EXECUTE format('GRANT ALL ON SEQUENCE public.%I TO service_role',v_table||'_id_seq'); END IF;
 END LOOP;
 FOR v_function IN SELECT p.oid::regprocedure AS signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'imob\_%' ESCAPE '\' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',v_function.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',v_function.signature);
 END LOOP;
END $$;

-- Anúncios são lidos pela API pública que aplica allowlist; nenhum documento privado possui policy pública.
-- Upload/remoção e URLs assinadas somente no backend com autorização de operação.
SELECT cron.schedule('imob-cobrancas-locacao','15 6 * * *','SELECT public.imob_gerar_cobrancas_locacao(NULL);');
SELECT cron.schedule('imob-limpar-cotacoes','35 6 * * *',$cron$DELETE FROM public.imovel_cotacao WHERE expira_em<now()-interval '7 days';$cron$);

WITH nomes(nome) AS (VALUES
 ('proprietarios:visualizar'),('proprietarios:criar'),('proprietarios:editar'),('proprietarios:excluir'),('proprietarios:acesso_portal'),('proprietarios:financeiro'),
 ('imoveis:visualizar'),('imoveis:criar'),('imoveis:editar'),('imoveis:excluir'),('imoveis:publicar'),('imoveis:financeiro'),
 ('reservas:visualizar'),('reservas:criar'),('reservas:editar'),('reservas:excluir'),('reservas:confirmar'),('reservas:cancelar'),('reservas:checkin_checkout'),('reservas:financeiro'),
 ('locacoes_imobiliarias:visualizar'),('locacoes_imobiliarias:criar'),('locacoes_imobiliarias:editar'),('locacoes_imobiliarias:excluir'),('locacoes_imobiliarias:confirmar'),('locacoes_imobiliarias:cancelar'),('locacoes_imobiliarias:financeiro'),
 ('vendas_imobiliarias:visualizar'),('vendas_imobiliarias:criar'),('vendas_imobiliarias:editar'),('vendas_imobiliarias:excluir'),('vendas_imobiliarias:concluir'),('vendas_imobiliarias:cancelar'),('vendas_imobiliarias:financeiro'))
INSERT INTO public.permissao(nome,descricao) SELECT nome,'Acesso imobiliário: '||nome FROM nomes ON CONFLICT(nome) DO NOTHING;
INSERT INTO public.perfilpermissao(perfilid,permissaoid)
 SELECT p.id,pe.id FROM public.perfil p CROSS JOIN public.permissao pe
 WHERE p.nome='Administrador' AND split_part(pe.nome,':',1) IN ('proprietarios','imoveis','reservas','locacoes_imobiliarias','vendas_imobiliarias')
ON CONFLICT(perfilid,permissaoid) DO NOTHING;

-- Classificações próprias: nenhum recebimento bruto do proprietário é receita da imobiliária.
INSERT INTO public.classificacoes_resultado(codigo,nome,descricao,familia,tratamento,naturezas,papel_dre) VALUES
 ('IMOB_ADMINISTRACAO','Administração imobiliária','Taxa administrativa calculada sobre recebimentos efetivos.','RECEITA','RESULTADO',ARRAY['RECEITA'],'RECEITA'),
 ('IMOB_COMISSAO','Intermediação imobiliária','Comissão de intermediação recebida.','RECEITA','RESULTADO',ARRAY['RECEITA'],'RECEITA'),
 ('IMOB_ESTORNO_ADMIN','Estorno de administração imobiliária','Devolução proporcional de taxa em reembolso efetivo.','DEDUCAO','RESULTADO',ARRAY['DESPESA'],'DEDUCAO')
ON CONFLICT(codigo) DO NOTHING;
DO $$
DECLARE t record; c record; v_linha integer; v_origem text;
BEGIN
 FOR t IN SELECT id FROM public.dre_template WHERE ativo LOOP
  FOR c IN SELECT * FROM public.classificacoes_resultado WHERE codigo IN ('IMOB_ADMINISTRACAO','IMOB_COMISSAO','IMOB_ESTORNO_ADMIN') LOOP
   SELECT id INTO v_linha FROM public.dre_linha WHERE template_id=t.id AND ativo AND tipo='DETALHE' AND natureza_dre=c.papel_dre ORDER BY (codigo=CASE WHEN c.papel_dre='RECEITA' THEN '1.2' ELSE '2.3' END) DESC,id LIMIT 1;
   IF v_linha IS NULL THEN RAISE EXCEPTION 'Template DRE % sem linha de % para o domínio imobiliário.',t.id,c.papel_dre; END IF;
   v_origem:=CASE c.codigo WHEN 'IMOB_ADMINISTRACAO' THEN 'ADMINISTRACAO_IMOBILIARIA:RECEITA' WHEN 'IMOB_COMISSAO' THEN 'COMISSAO_IMOBILIARIA:RECEITA' ELSE 'ESTORNO_ADMINISTRACAO_IMOBILIARIA:DESPESA' END;
   INSERT INTO public.dre_mapeamento(template_id,linha_id,origem_tipo,classificacao_resultado_id,observacao) SELECT t.id,v_linha,'CLASSIFICACAO_RESULTADO',c.id,'Domínio imobiliário' WHERE NOT EXISTS(SELECT 1 FROM public.dre_mapeamento WHERE template_id=t.id AND origem_tipo='CLASSIFICACAO_RESULTADO' AND classificacao_resultado_id=c.id AND ativo);
   INSERT INTO public.dre_mapeamento(template_id,linha_id,origem_tipo,origem_valor,classificacao_resultado_id,observacao) SELECT t.id,v_linha,'EVENTO_ORIGEM',v_origem,c.id,'Domínio imobiliário' WHERE NOT EXISTS(SELECT 1 FROM public.dre_mapeamento WHERE template_id=t.id AND origem_tipo='EVENTO_ORIGEM' AND origem_valor=v_origem AND ativo);
  END LOOP;
 END LOOP;
END $$;
