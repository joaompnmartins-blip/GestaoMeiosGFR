# Contexto de trabalho — GOGFR

Estado do projecto, topologia dos ambientes e assuntos em aberto.
**Última actualização:** 16/08/2026.

Este ficheiro serve para retomar o trabalho sem redescobrir o terreno. O que
mudou em cada alteração está em [`MUDANCAS_BETA2.md`](MUDANCAS_BETA2.md); o plano
de testes manual está em [`TESTPLAN.md`](TESTPLAN.md).

---

## 1. Topologia

| | |
|---|---|
**Repositório** | `github.com/joaompnmartins-blip/GestaoMeiosGFR` |
**Projecto Railway** | `melodious-ambition` |
**Aplicação** | ficheiro único `Gestao_Meios_v17.html` (~613 KB) + `server.js` + PostgreSQL 18 |
**Serviço Railway** | `GestaoMeiosGFR` (app) e `Postgres`, em cada ambiente |

### Ambientes

| Ambiente | Ramo | URL | Base de dados |
|---|---|---|---|
`beta1` | `beta1` | `gestaomeiosgfr-beta1.up.railway.app` | **dados reais** — 844 viaturas, 856 recursos, ocorrências verdadeiras |
`beta2` | `beta2` | `gestaomeiosgfr-beta2.up.railway.app` | clone do beta1 de 13/08, com dados de teste acumulados |
`production` | `main` | — | **`main` está 199 commits atrás.** Ambiente a servir uma versão de Julho; decidir se se elimina ou se aponta para outro ramo |

O `beta2` tem **Postgres próprio**. Código e migrações promovem-se com o ramo;
**SQL aplicado à mão não viaja** — é por isso que cada entrada do registo diz o
que seria preciso repetir.

---

## 2. Regime de trabalho em vigor

**Só se faz commit no `beta2`.** O `beta1` está congelado e a sua única
actualização é a promoção:

```bash
git checkout beta1 && git merge --ff-only beta2 && git push <remoto> beta1
```

Enquanto o `beta1` não receber commits próprios, a promoção nunca gera
conflitos — o que importa porque **82% dos commits tocam um único ficheiro de
613 KB** e um merge a sério ali não se resolve à mão com confiança.

A promoção é **por ordem de commits**: leva tudo até ao ponto escolhido, não uma
alteração isolada.

Cada alteração fica registada em `MUDANCAS_BETA2.md` com âmbito, como validar, e
o que exige repetição no beta1.

### Estado actual dos ramos

```
beta1  8e6f4fb   (alterações 1–9 promovidas)
beta2  1299668   (alterações 10–14, por validar)
```

---

## 3. Armadilhas operacionais

**`git push origin` falha.** O `~/.git-credentials` está vazio desde 13/08 e o
`gh` não está instalado. O SSH funciona e autentica como `joaompnmartins-blip`:

```bash
git push git@github.com:joaompnmartins-blip/GestaoMeiosGFR.git beta2
```

Correcção durável: `git remote set-url origin git@github.com:joaompnmartins-blip/GestaoMeiosGFR.git`

**O proxy TCP do Railway é intermitente.** Ligações a
`hayabusa.proxy.rlwy.net:17223` falham por vezes no handshake mesmo com o TCP
aberto. O acesso por SSH nunca falhou:

```bash
railway ssh --environment beta2 --service Postgres 'psql "$DATABASE_URL"' < ficheiro.sql
```

**O `latestDeployment.meta.branch` do `railway status` mostra o ramo do último
deployment, não a configuração actual.** Depois de mudar o gatilho de ramo, só
reflecte a mudança quando um build novo termina — foi o que fez parecer que a
mudança não tinha sido aplicada.

**Verificar o deploy pelo tamanho servido** é o método mais rápido:

```bash
wc -c < Gestao_Meios_v17.html
curl -s -o /dev/null -w '%{size_download}' https://gestaomeiosgfr-beta2.up.railway.app/
```

**O browser retém o pacote antigo.** Vários «bugs» desta sessão eram cache.
`Ctrl+Shift+R` antes de julgar qualquer alteração.

---

## 4. Testes automáticos

Base de dados dedicada `gestao_meios_test`, no mesmo servidor Postgres do beta1:

```bash
TEST_DATABASE_URL="postgresql://postgres:<pw>@hayabusa.proxy.rlwy.net:17223/gestao_meios_test" npx jest
```

A palavra-passe vem de `railway variables --service Postgres --kv`
(`DATABASE_PUBLIC_URL`), trocando `/railway` por `/gestao_meios_test`.

- **72 de 81 a passar.** As 9 falhas são **testes desactualizados, não
  regressões**: sete usam a tabela `equipas`, substituída por `recursos`; duas
  afirmam comportamentos que o código mudou de propósito — que se pode
  desmobilizar um meio em trânsito, e que um `ofligacao` pode eliminar um meio.
- `jest.config.js` fixa `maxWorkers: 1`: todos os ficheiros partilham a mesma
  base e em paralelo dão 46 falhas fantasma.
- `tests/helpers/testdb.js` recusa um `TEST_DATABASE_URL` com `railway` sem
  `_test`, para não truncar produção.
- **Desde `fb47b9f` o conjunto não voltou a correr** — o proxy esteve
  inacessível. Demora ~90 s.

---

## 5. Modelo de domínio que não se adivinha do código

### Perfis

Hierarquia: `visualizador < operacional < ofligacao < ofligacao_ccon < admin`.
Ortogonais: `gestor_sf`, `gestor_fsbf`, `gestor_icnf`, `chefe_grupo_fsbf`.

A **máquina de estados** dos meios só é imposta ao perfil `operacional`;
`ofligacao` e `admin` podem corrigir. É isso que sustenta a excepção de
administrador nos bloqueios de edição.

### Meios compostos

| | O pai é um meio? | Efectivo conta de |
|---|---|---|
**BSF** (composição) | não — é o rótulo | dos **filhos** |
**BSBF** (`deploy/fsbf-bsbf`) | não — é o rótulo | do **pai** (soma das guarnições da Carta de Meios) |
**EMR** (`deploy/fsbf-emr`) | **sim** — é a máquina de rasto | do **pai** (`total_op` do cartão da carta) |

Distingue-se pela **origem** — `composicao_id`, `fsbf_bsbf_id`, `fsbf_emr_id` — e
nunca pelo `tipo` (a edição apaga-o) nem pela viatura (só 1 de 3 pais EMR tem).

Uma EMR são **4 meios**: MR, VAOP, VTTP e VLCI.

`destacado` (booleano) retira um meio do conjunto sem perder a origem.
Agrupado = `meio_pai_id IS NOT NULL AND NOT destacado`. Destacar desconta o
efectivo do contentor; reagrupar repõe.

### FSBF

- **Companhias:** Norte, Centro, Sul. **Cada base pertence a uma só companhia.**
  Norte: Cabeceiras de Basto, Macedo de Cavaleiros, Vila Pouca de Aguiar.
  Centro: Arganil, Guarda, Marinha Grande, Proença-a-Nova, Viseu.
  Sul: Olhão, Portalegre, Santarém. Sem operacionais: CNFSBF, Lisboa, Ponte de Lima.
- **`Norte`/`Sul` nos títulos da carta são companhias, não bases.**
- No **GSBF** a coluna Base é o *local de pré-posicionamento* — para onde o meio
  vai, não de onde vem.
- **A companhia de uma viatura não se deduz da base.** As percentagens por
  companhia no separador Empenhamento são indicativas.
- Empenhado = a linha da carta tem **ocorrência atribuída**, não apenas constar.
- **1 operacional sem base:** José Motaco, 2.º Comandante Nacional.
- **`Loulé`** aparece num cartão EMR e não existe em `FSBF_BASES` — decidir se é
  `Olhão` ou se Loulé entra na lista.

### Fusão de ocorrências

Irreversível por desenho: transfere os meios para o destino e deixa a origem
vazia com `merged_into`. Só ocorrências `closed` têm botão *Reabrir*.

---

## 6. Defeitos conhecidos, não corrigidos

**`PATCH /api/meios/:id/estado`** actualiza `WHERE id=$1 OR meio_pai_id=$1` sem
validar a máquina de estados nem verificar duplo empenhamento, ao contrário do
`PATCH /api/meios/:id`. O cliente não o usa, mas está exposto a `operacional`.

**Os índices únicos não cobrem `previsto`.** `OCUPADO_ESTADOS` inclui-o, os
índices `idx_meios_recurso_active` e `idx_meios_viatura_active` não. Foi a
brecha que deixou empenhar `BRIG 01-115` três vezes. Alinhá-los fecharia o
problema para todos os meios — **mas exige limpar os duplicados primeiro**, ou a
criação do índice falha.

**O dropdown Tipo apaga valores que não contém.** Faltam `BSBF`, `ESF`, `TGFR`,
`ECNAF`, `EGFR`, `EVN`, `DIR`, `EFSBF`, `VTTP`, `EMR` — cerca de 85 meios cujo
tipo é silenciosamente esvaziado ao editar. Já aconteceu ao contentor
`BSBF Sul`. A correcção é a que o dropdown de Base já usa: manter o valor actual
como opção. Para contentores, um tipo vazio pode ser correcto.

**A aplicação não cria uma base de dados de zero.** Dependência circular entre
`preSchemaAlters` e `schema.sql`. Não afecta ambientes existentes; impede
levantar um novo sem clonar.

**`applyOpToTeam` mistura fusos:** a hora do limite vem de `toTimeString()`
(local) e a data de `toISOString()` (UTC), pelo que um limite depois da
meia-noite grava `limite_op_date` no dia anterior. Latente — o `timeInfo` não lê
essa coluna.

**Duplicados de `BRIG 01-115`** em *Porto, Matosinhos*: três empenhamentos, com
os filhos em `previsto` e os pais em `transito`/`operacao`. Decidido manter como
está por agora.

**Sem integração contínua.** Nada corre os testes num push.

---

## 7. Decisões em aberto

1. **Caixa «aplicar a todos»** nas acções rápidas — proposto retirá-la e
   propagar sempre, ficando *destacar* como forma deliberada de mover um meio
   sozinho.
2. **Contentores nos cartões por estado** — excluí-los da contagem está feito;
   falta decidir se continuam a aparecer como cartão.
3. **`setTypeParser(1082)`** no servidor, para as colunas `DATE` chegarem como
   texto em toda a aplicação. Resolveria o mesmo problema nas outras oito
   tabelas com colunas `DATE`, mas muda o comportamento de tudo o que conte com
   receber um objecto `Date`.
4. **`ofligacao_ccon` deve poder reabrir ocorrências?** Hoje pode; o
   `ofligacao` regional não.
5. **25 correcções de marca/modelo** em `analise_db/comparacao_meios_icnf_v2_vs_bd.csv`
   — 17 são troca de campos, 8 exigem olhar linha a linha.
6. **490 indicativos de viatura** por substituir no mesmo ficheiro: a base tem
   códigos sintetizados (`VLCI 90-XJ-97`) onde o ficheiro tem o indicativo real
   (`CNAF 12`). Aplicável sem colisões (1 excepção), mas renomeia 54% da frota.

---

## 8. Documentos e ficheiros por versionar

Estão no disco e **fora do git** — decidir o que entra:

`TESTPLAN.md` · `MEGFR_SPEC_COMPLETA.md` · `TODO_beta1.md` · `future_changes.md` ·
`fsbf/autorizacao_fora_de_base.md` · `analise_db/` · `fsbf/nova_versao_stats/` ·
`fsbf/anotacoes_GRUATA/` e vários CSV.

Publicados como páginas:

- **Percurso de teste de ponta a ponta** — 55 passos, da abertura ao arquivo.
  Escrito antes das alterações 1–14; precisa de revisão.
- **Estratégia de ramos e ambientes** — o desenho que este regime segue.

---

## 9. Limpezas pendentes nos dados

- **`Teste 1 + Setúbal`** (fechada, beta1) mantém `SF 01-162`, `SF 01-165` e
  `SF 04-166` em `operacao`: **3 recursos indisponíveis**. Fechar uma ocorrência
  não liberta meios — a nova regra impede que volte a acontecer, mas não repara
  o que já existe.
- **`ZZTESTE Sertã`** e o seu posto retêm dois oficiais de ligação.
- Um meio com `guarnicao` fora do previsto foi corrigido; os `CHECK` de
  guarnição estão aplicados.
