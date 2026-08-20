# Mudanças em teste — beta2

Registo das alterações aplicadas **apenas ao beta2**
(`gestaomeiosgfr-beta2.up.railway.app`), à espera de validação. Depois de
aprovadas passam ao beta1 por `git merge --ff-only beta2`.

## Como isto funciona

- **O beta1 não recebe commits** enquanto estiver neste modo. A sua única
  actualização é a promoção por fast-forward, que assim nunca gera conflitos —
  o que importa porque o frontend é um ficheiro único de ~590 KB.
- **A promoção é por ordem de commits.** Um fast-forward leva *tudo* até ao
  ponto escolhido, não uma alteração isolada. Aprovar a 3.ª e rejeitar a 2.ª
  obriga a refazer.
- **As alterações de dados não viajam com o ramo.** O beta2 tem base de dados
  própria. Código e migrações promovem-se sozinhos; SQL aplicado à mão não. Por
  isso cada entrada regista o SQL exacto, para poder ser repetido no beta1.

## Estado

| # | Data | Alteração | Commit | Estado |
|---|---|---|---|---|
| 1 | 13/08/2026 | Oficiais de ligação vêem os pedidos de remoção | `9af294c` + `51c905a` | em beta1 e beta2 |
| 2 | 13/08/2026 | Editar Meio segue o percurso de estados | `42a447b` | em beta1 e beta2 |
| 3 | 13/08/2026 | Remoção de meio agregado mostra e protege os filhos | `a916cd8` | em beta1 e beta2 |
| 4 | 13/08/2026 | Datas da API normalizadas; fim do NaNhNaNm | `5675684` | em beta1 e beta2 |
| 5 | 13/08/2026 | Arquivo aberto ao ofligacao, com filtros de data e sub-região | `d87a025` | em beta1 e beta2 |
| 6 | 13/08/2026 | Reabrir ocorrência deixa de estar ao alcance do ofligacao | `1fa7098` | em beta1 e beta2 |
| 7 | 13/08/2026 | MR seleccionáveis nas linhas de brigada; exclusão do que já está na carta | `da98420` | em beta1 e beta2 |
| 8 | 13/08/2026 | 2.º Comandante Nacional elegível para Coordenador de Dia e Chefe de Grupo | `7baf34b` | em beta1 e beta2 |
| 9 | 16/08/2026 | Editar Meio de composições BSF já não herda o estado do modal de Adicionar | `ef9fc7b` | em beta1 e beta2 |
| 10 | 16/08/2026 | Violações de restrição deixam de ser 500 e de bloquear a fila de sincronização | `02d7157` | **por validar (só beta2)** |
| 11 | 16/08/2026 | Operacionais deixam de ser contados a dobrar em meios compostos | `7638704` | **por validar (só beta2)** |
| 12 | 16/08/2026 | Editar Meio passa a propagar o estado ao conjunto composto | `40e2312` | **por validar (só beta2)** |
| 13 | 16/08/2026 | Uma composição não pode ser empenhada duas vezes | `9d83044` | **por validar (só beta2)** |
| 14 | 16/08/2026 | Conjuntos compostos: contentor não é meio, acções ao nível do grupo, destacar/reagrupar | `1299668` | **por validar (só beta2)** |
| 15 | 16/08/2026 | Viatura de um meio EGFR atribuível depois do despacho | `f6b00a0` | **por validar (só beta2)** |
| 16 | 18/08/2026 | Modais de Meio: ordem das caixas, limites de operação condicionais, botão de operacionais | `2d6889f` | **por validar (só beta2)** |
| 17 | 18/08/2026 | Nomes dos operacionais legíveis no tema claro | `b82d25d` | **por validar (só beta2)** |
| 18 | 18/08/2026 | Conjuntos compostos recolhidos dentro do cartão do pai | `a88a182` | **por validar (só beta2)** |
| 19 | 18/08/2026 | Guarnição da Carta de Meios chega ao meio (BSBF e EMR) · **com correcção de dados** | `b71a7fe` | **por validar (só beta2)** |
| 20 | 19/08/2026 | Retomar operação depois do descanso repõe o tempo de operação | `b70153f` | **por validar (só beta2)** |
| 21 | 19/08/2026 | Adicionar Meio deixa de oferecer o estado Descanso | `f568ee3` | **por validar (só beta2)** |
| 22 | 19/08/2026 | Empenhar um meio directamente num PCF/AIM (modal e despachos) | `5dc599f` | **por validar (só beta2)** |
| 23 | 19/08/2026 | «N.º Operacionais» deixa de parecer preenchido com 4 | `bed08c8` | **por validar (só beta2)** |
| 24 | 19/08/2026 | Meio desmobilizado deixa de mostrar Setor, Posto e Missão | `a748c02` | **por validar (só beta2)** |
| 25 | 19/08/2026 | Missão com acção própria no cartão, registada na Fita do Tempo | `2a0751d` | **por validar (só beta2)** |
| 26 | 20/08/2026 | Categoria «Missão» na Fita do Tempo, com o meio identificado | `2f25c99` | **por validar (só beta2)** |
| 27 | 20/08/2026 | Contagens de setor/PCO sem contentores; rótulos Veículos/Descanso/Operacionais | `32d4b2d` | **por validar (só beta2)** |
| 28 | 20/08/2026 | Todos os contadores de meios da aplicação sem contentores | `f1a89ee` | **por validar (só beta2)** |
| 29 | 20/08/2026 | Carta de Meios: linha da EMR deixa de sair fora do cartão | `8d30481` | **por validar (só beta2)** |
| 30 | 20/08/2026 | Vista de Tabela: conjuntos compostos numa só linha | `a662e86` | **por validar (só beta2)** |
| 31 | 20/08/2026 | Meios já despachados apareciam livres na lista do ofligacao_ccon | `b4fa875` | **por validar (só beta2)** |
| 32 | 20/08/2026 | EGFR: mesma falha de exclusividade, e o despacho aceitava duplicar a equipa | `d258c0b` | **por validar (só beta2)** |
| 33 | 20/08/2026 | Tempo total de operação no cartão e na tabela | `7187ad4` | **por validar (só beta2)** |
| 34 | 20/08/2026 | Sem crachás de nomes nos cartões de BSBF e EMR | `5360c03` | **por validar (só beta2)** |
| 35 | 20/08/2026 | Gestão ICNF em consulta para o oficial de ligação | `c55f675` | **por validar (só beta2)** |
| 36 | 20/08/2026 | Disponíveis nas estatísticas de empenhamento FSBF · **com correcção de dados** | `1f141f3` | **por validar (só beta2)** |

As nove foram promovidas ao beta1 por `git merge --ff-only beta2`.
O registo mantém-se: descreve o que mudou, como validar, e o que seria preciso
repetir numa promoção — em nenhuma delas há alterações de base de dados.

---

## 1 — Oficiais de ligação vêem os pedidos de remoção

**Data:** 13/08/2026 · **Estado:** por validar

### O que muda

O separador **Pedidos** era exclusivo do `admin`. Quem submete os pedidos — os
oficiais de ligação — não tinha forma de saber em que estado ficavam. Passa a
estar visível para `ofligacao` e `ofligacao_ccon`, em leitura.

Os botões **✓ Aprovar** e **✕ Rejeitar** continuam a aparecer só ao `admin`.
Para os restantes, a coluna de acções mostra *«aguarda decisão do
administrador»*.

O texto introdutório da página adapta-se ao perfil: ao administrador explica o
efeito de aprovar e rejeitar; ao oficial de ligação explica que a decisão não é
sua e que, enquanto o pedido está pendente, o meio não pode ser editado nem
mudar de estado.

### Quem vê o quê

| Perfil | Vê o separador | Aprovar / Rejeitar |
|---|---|---|
| `admin` | sim | **sim** |
| `ofligacao_ccon` | sim | não |
| `ofligacao` | sim | não |
| `operacional`, `visualizador`, perfis de módulo | não | não |

### Porque é seguro

A separação já existia no servidor e não foi tocada:

| Endpoint | Exige |
|---|---|
| `GET /api/delete-requests` | `visualizador` |
| `POST /api/delete-requests/:id/approve` | `admin` |
| `POST /api/delete-requests/:id/reject` | `admin` |

Esconder os botões passa a **coincidir** com o que a API impõe, em vez de
esconder acções que dariam 403. Nenhum perfil ganha permissão nova: o `ofligacao`
já podia ler este endpoint, apenas não tinha por onde chegar à página.

### Alterações

- `Gestao_Meios_v17.html` — item de navegação passa de `auth-admin` a
  `auth-ofligacao`; **`navTo()` deixa de exigir `admin` para a página
  `pedidos`**; `renderDeleteRequests()` condiciona os botões a
  `currentRole==='admin'`; nota da página adaptada ao perfil.
- **Servidor:** nenhuma.
- **Base de dados:** nenhuma. *(Nada a repetir no beta1 na promoção.)*

### Correcção após o primeiro teste (13/08)

Mostrar o item de navegação não bastava: o `navTo()` tinha um segundo
controlo que agrupava `pedidos` com `utilizadores` e recusava tudo o que não
fosse `admin` — o separador aparecia mas clicar devolvia *«Acesso restrito a
administradores»*. Os dois controlos estavam separados no código e só um
tinha sido alterado.

São agora três pontos, coerentes entre si: visibilidade do item,
`navTo()`, e os botões. `utilizadores` mantém-se exclusivo do `admin`.

### Por decidir

A lista mostra **todos** os pedidos, com o estado em crachá, e não apenas os
pendentes — de outro modo um oficial de ligação não veria o desfecho dos seus
próprios pedidos. Se preferir que veja só os pendentes, é um filtro de uma linha.

### Como validar

1. Entrar como `ofligacao` e confirmar que **Pedidos** aparece na barra lateral.
2. Confirmar que a lista se vê e que **não há** botões Aprovar/Rejeitar.
3. Entrar como `admin` e confirmar que os botões continuam lá e funcionam.
4. Confirmar que `operacional` e `visualizador` continuam sem o separador.

### Testes automáticos

Não executados: o proxy TCP do Railway está inacessível a partir da máquina de
desenvolvimento (o acesso por `railway ssh` funciona). A alteração é de
interface e não toca no servidor.

---

## 2 — Editar Meio segue o percurso de estados

**Data:** 13/08/2026 · **Estado:** por validar

### O que muda

O modal **Adicionar Meio** já revelava os campos por fases, conforme o estado
escolhido. O **Editar Meio** não: `toggleMobilizacaoFields(estado, isEdit)` tinha
`isEdit ||` em todas as condições, ou seja, em edição mostrava tudo e permitia
tudo. Passa a acompanhar o percurso, que é de sentido único — um meio não
regressa a um estado que já deixou.

**A identidade do meio fixa-se ao criar.** Em edição ficam em leitura: meio
predefinido, Designação/Eq.nº, Tipo, Matrícula e Origem/Concelho. Continuam
editáveis **Responsável/Chefe Equipa** e **Contacto** — o chefe muda ao longo de
uma ocorrência longa e o número pode ter de ser corrigido.

**Os dados das fases já cumpridas ficam em leitura**, não escondidos: assim o
registo continua visível (quando foi despachado, quando chegou) sem poder ser
alterado.

| Estado do meio | Em leitura | Editável |
|---|---|---|
| Previsto | — | Previsto, Trânsito, Operação, Demob. |
| Em Trânsito | Previsto | Trânsito, Operação, Demob. |
| Em Operação | Previsto, Trânsito | Operação, Demob. |
| Em Descanso | Previsto, Trânsito | Operação, Demob. |
| Desmobilizado | Previsto, Trânsito, Operação | Demob. |

**Chegada à base e km ficam sempre editáveis**, em qualquer estado: são
registados no regresso, depois de o meio já estar desmobilizado.

**Em Descanso conta como Em Operação.** Não é um passo em frente — o meio volta
de lá à operação — pelo que bloqueia exactamente o mesmo.

### Selector de estado

Passa a oferecer apenas o estado actual e os sucessores legais, espelhando a
máquina de estados que o servidor já impõe ao perfil `operacional`:

| Estado actual | Opções oferecidas |
|---|---|
| Previsto | Previsto, Em Trânsito |
| Em Trânsito | Em Trânsito, Em Operação |
| Em Operação | Em Operação, Em Descanso, Desmobilizado |
| Em Descanso | Em Descanso, Em Operação, Desmobilizado |
| Desmobilizado | Desmobilizado *(terminal)* |

Em **Adicionar** a lista mantém-se completa: aí não há transição, escolhe-se o
estado inicial, e registar um meio já em operação é legítimo.

### Excepção de administrador

O perfil `admin` continua a poder editar tudo e a ver os cinco estados. Uma nota
no topo do bloco de estado diz qual dos dois casos se aplica, para que os campos
fechados se leiam como fechados de propósito e não como avaria.

### Alterações

- `Gestao_Meios_v17.html` — `MEIO_ETAPA`, `MEIO_TRANSICOES`, `MEIO_CAMPOS_FASE`
  e `MEIO_CAMPOS_IDENTIDADE`; `aplicarBloqueiosEdicao()`, `meioEstadoOpts()`,
  `meioEstadoOptsCompleto()`, `bloquearCampo()`; `toggleMobilizacaoFields()`
  passa a aplicar bloqueios em edição; `editTeam()` e `openAddTeam()` ligados;
  classe CSS `.campo-bloqueado`; nota `#team-bloqueio-nota`.
- **Servidor:** nenhuma. A máquina de estados já existia no
  `PATCH /api/meios/:id` e continua a ser imposta só ao perfil `operacional` —
  é isso que sustenta a excepção de administrador.
- **Base de dados:** nenhuma. *(Nada a repetir no beta1 na promoção.)*

### Como validar

1. Adicionar um meio em **Previsto** — todos os campos livres, cinco estados na lista.
2. Reabrir em edição: Designação, Tipo, Matrícula e Concelho a cinzento
   tracejado; Responsável e Contacto editáveis.
3. Passar a **Em Trânsito** e reabrir: a data prevista fica em leitura e o
   selector já não oferece Previsto.
4. Passar a **Em Operação**: despacho e saída também em leitura; só restam
   Operação, Descanso e Desmobilizado.
5. **Desmobilizar**: tudo em leitura excepto demob, chegada à base e km.
6. Entrar como `admin` no mesmo meio: tudo editável, cinco estados, com a nota
   a explicar porquê.

### Testes automáticos

Não executados — alteração exclusivamente de interface, sem toque no servidor.
A matriz de bloqueios e o selector foram verificados por simulação directa das
tabelas de estado.

---

## 3 — Remoção de meio agregado mostra e protege os filhos

**Data:** 13/08/2026 · **Estado:** por validar

### O ponto de partida

O pedido de remoção de um meio-pai não oferecia a opção de aplicar aos meios
agregados, ao contrário das mudanças de estado. Ao investigar percebeu-se que
**não há opção a oferecer**: `meio_pai_id` é `ON DELETE CASCADE`, e aprovar o
pedido faz `DELETE FROM meios WHERE id=$1` sobre o pai — a base remove os filhos
sempre. A remoção de um pai leva os agregados, não é opcional.

O que faltava não era a escolha, era dizê-lo. E três defeitos reais em volta.

### O que muda

**O modal do pedido nomeia os filhos.** Passa a indicar quantos meios agregados
são removidos em conjunto, lista-os, e diz explicitamente que não é opcional.

**Um pedido pendente sobre o pai protege os filhos.** Antes,
`hasPendingDelete()` testava apenas o id do próprio meio: enquanto o pedido do
pai aguardava decisão, os filhos continuavam editáveis e podiam mudar de estado —
estando prestes a ser eliminados. Agora um pedido sobre o pai bloqueia também os
filhos, no cliente e no servidor.

**Ao aprovar, os filhos saem do ecrã.** O cliente removia só o pai de
`db.teams`, pelo que os filhos ficavam visíveis a apontar para um pai
inexistente até ao recarregamento seguinte. Se algum filho for um PM, o
transporte do MR é libertado, como já acontecia para o pai.

**A lista de Pedidos mostra a dimensão real.** Cada pedido pendente indica
`+N agregados removidos em conjunto`, para que quem aprova — decisão
irreversível — veja que não está a remover um meio mas quatro.

### Alterações

- `Gestao_Meios_v17.html` — `filhosDe()`; `hasPendingDelete()` alargado ao pai;
  aviso com a lista de agregados em `openDeleteRequestModal()`; limpeza dos
  filhos em `resolveDeleteRequest()`; contagem na coluna Meio de
  `renderDeleteRequests()`.
- **Servidor** — `hasPendingDeleteRequest()` passa a considerar um pedido
  pendente sobre o `meio_pai_id`. Protege os quatro pontos que já a usavam:
  `PATCH /api/meios/:id`, `PATCH /api/meios/:id/estado`,
  `PUT /api/meios/:id/operativos` e o próprio pedido de remoção.
- **Base de dados:** nenhuma. *(Nada a repetir no beta1 na promoção.)*

### Verificação feita

Consulta nova testada contra dados reais do beta2, dentro de uma transacção
revertida: com um pedido pendente sobre `BRIG 01-115`, o pai e os seus três
filhos (`SF 39-115`, `SF 40-115`, `SF 41-115`) ficam bloqueados, e meios sem
relação não são afectados.

### Como validar

1. Pedir a remoção de um meio com agregados: o aviso deve nomeá-los e dizer que
   vão em conjunto.
2. Com o pedido pendente, tentar editar um dos filhos — deve ser recusado.
3. Como `admin`, ver em **Pedidos** a indicação `+3 agregados`.
4. Aprovar: pai e filhos desaparecem da listagem sem recarregar a página.
5. Rejeitar noutro caso: pai e filhos voltam a ser editáveis.

---

## 4 — Datas da API normalizadas; fim do `NaNhNaNm`

**Data:** 13/08/2026 · **Estado:** por validar

### A causa

As colunas `DATE` chegavam ao cliente como instantes ISO completos. O
node-postgres converte `DATE` num objecto `Date` e o `res.json()` serializa-o
inteiro:

```
data_chegada: "2026-08-04T23:00:00.000Z"    ← e não "2026-08-05"
hora_chegada: "16:15:00"
new Date(`${data}T${hora}`)  →  Invalid Date
```

Reparar que o instante é do **dia anterior**: Lisboa está em UTC+1, e a meia-noite
local do dia 5 é 23:00Z do dia 4. Cortar os 10 primeiros caracteres daria a data
errada — é preciso ler as componentes **locais**.

Daí vinha o `NaNhNaNm`: o `timeInfo()` passava a guarda (chegada preenchida),
construía uma data inválida, e como `NaN` falha todas as comparações caía no
último ramo — justamente o que imprime `${Math.floor(NaN/60)}h…`. A barra ficava
com `width:NaN%`.

**Não era um caso limite: afectava todos os meios com chegada registada.**

### Alcance verificado

O mesmo valor por tratar era usado em mais três sítios:

| Onde | Efeito |
|---|---|
| `<input type="date">.value = t.dataChegada` (5 campos no Editar Meio) | campo em branco — a data existe mas não aparece |
| `fmtDateShort()` faz `d.split('-')` | mostrava `04T23:00:00.000Z/08` |
| `parseDT()` em `validateMeioDates()` | validações de cronologia a comparar `NaN` |

### O que muda

**Uma normalização única no ponto de entrada.** `dataISO()` converte para
`YYYY-MM-DD` a partir das componentes locais, e é aplicada em `mapTeam()` aos
oito campos de data do meio: `data_despacho`, `data_saida_entidade`,
`data_chegada`, `data_demob`, `data_chegada_entidade`, `previsto_data`,
`limite_op_date` e `egfr_data`. Todos os consumidores passam a receber a forma
que esperavam.

**Mensagem em vez de silêncio quando faltam dados.** O `timeInfo()` passava a
devolver `null` e o cartão não mostrava nada. Passa a devolver um estado
`semInfo` com o que é preciso indicar:

| Situação | Texto no cartão |
|---|---|
| Sem chegada | *Sem info — indicar Chegada ao TO* |
| Chegada, sem limite | *Sem info — indicar Tempo máximo Op.* |
| Sem ambos | *Sem info — indicar Chegada ao TO + Tempo máximo Op.* |
| Datas impossíveis de ler | *Sem info — datas por validar* |

Sem barra de progresso e em cinzento discreto: falta de dados não é urgência.
Estes cartões também deixam de contar para o alerta de 85% e de subir na
ordenação por urgência, onde antes entravam com `pct` a zero ou `NaN`.

### Alterações

- `Gestao_Meios_v17.html` — `dataISO()` novo; `mapTeam()` normaliza 8 campos;
  `timeInfo()` devolve `semInfo` e ganha guarda final contra datas inválidas;
  cartão e tabela mostram o texto sem barra; alerta e ordenação ignoram `semInfo`;
  classe CSS `.right.sem-info`.
- **Servidor:** nenhuma.
- **Base de dados:** nenhuma. *(Nada a repetir no beta1 na promoção.)*

### Por decidir — correcção na origem

A alternativa de fundo é `require('pg').types.setTypeParser(1082, v => v)` no
servidor, que faz o `DATE` chegar como texto a **toda** a aplicação. Resolveria
o mesmo problema noutras tabelas que também têm colunas `DATE` e chegam ao
cliente — `fsbf_carta`, `fsbf_bsbf_equipa`, `fsbf_emr_equipa`, `fsbf_gruata`,
`egfr_escala`, `egfr_viatura`, `fsbf_empenhamento_diario`, `recursos.prontidao_ate`.
Fica de fora desta alteração por ser de alcance largo: tudo o que hoje conte com
receber um objecto `Date` mudaria de comportamento, e merece entrada própria e
teste dedicado.

### Como validar

1. Um meio em operação com chegada e tempo máximo: o contador mostra `XhYYm` e a
   barra enche — em vez de `NaNhNaNm`.
2. Abrir esse meio em Editar: os campos de data aparecem preenchidos.
3. Na tabela, a coluna de datas mostra `dd/mm` e não `04T23:00:00.000Z/08`.
4. Um meio em operação sem tempo máximo: cartão diz *Sem info — indicar Tempo
   máximo Op.*, sem barra.
5. Confirmar que a lista de alertas deixa de incluir cartões sem informação.

---

## 5 — Arquivo aberto ao oficial de ligação, com filtros de data e sub-região

**Data:** 13/08/2026 · **Estado:** por validar

### O que estava

O **Arquivo** partilhava a regra de visibilidade com o **Meios** (catálogo de
predefinidos): uma única lista escondia ambas as páginas a `ofligacao` e aos
quatro perfis de módulo, e o `navTo()` recusava o acesso ao `ofligacao` com
*«Acesso não disponível para Oficiais de Ligação regionais»*. Na prática só
`admin`, `ofligacao_ccon`, `operacional` e `visualizador` lá chegavam.

O `renderArquivo()` tinha um ramo que recortava a lista à sub-região do oficial
de ligação — código que **nunca podia correr**, porque esse perfil não chegava à
página. Terá havido a intenção de lhe dar o arquivo da sua área, mais tarde
fechada, e o filtro ficou pelo caminho.

O filtro de sub-região existia mas era exclusivo do `admin`, com a classe
`auth-admin` e `display:none`.

### O que muda

**As duas páginas deixam de partilhar a regra.** `ofligacao` passa a ver o
Arquivo; continua sem o catálogo de Meios. Os perfis de módulo mantêm-se sem
nenhuma das duas.

| Perfil | Arquivo | Meios (catálogo) |
|---|---|---|
| `admin`, `ofligacao_ccon`, `operacional`, `visualizador` | sim | sim |
| `ofligacao` | **sim** (antes não) | não |
| `gestor_sf`, `gestor_fsbf`, `gestor_icnf`, `chefe_grupo_fsbf` | não | não |

**O arquivo é completo para quem lá chega.** O recorte por sub-região do
oficial de ligação foi removido — vê tudo, e usa o filtro se quiser restringir.

**O filtro de sub-região deixa de ser exclusivo do admin** e é preenchido a
partir das ocorrências arquivadas.

**Novo filtro por data de início**, com *de* e *até*, mais um botão **Limpar
filtros** que repõe pesquisa, sub-região e datas. Os filtros combinam-se.

A comparação de datas é feita em texto `YYYY-MM-DD`, sobre o valor passado por
`dataISO()`. Converter para `Date` reintroduziria o desvio de fuso que já causou
o `NaNhNaNm` e o deslocamento de um dia noutros pontos. Ocorrências sem data de
início ficam de fora de qualquer intervalo — não têm por onde ser comparadas.

### Não alterado

A **fusão continua irreversível**, como estava: o botão *Reabrir* aparece apenas
em ocorrências `closed`, nunca em `merged`. Fundir transfere os meios para a
ocorrência de destino e deixa a origem vazia com um apontador `merged_into`;
reabri-la poria uma ocorrência activa e sem meios na lista, sem desfazer a
transferência. As quatro ocorrências fundidas não têm um único meio.

### Alterações

- `Gestao_Meios_v17.html` — visibilidade de `equipas` e `arquivo` separada em
  `applyRoleUI()`; `navTo()` deixa de barrar o arquivo ao `ofligacao`;
  `renderArquivo()` sem o recorte por sub-região, com filtro de sub-região para
  todos e novo filtro por data; `limparFiltrosArquivo()`; campos `arq-de` e
  `arq-ate` no cabeçalho da página.
- **Servidor:** nenhuma. `GET /api/ocorrencias` já exigia apenas `visualizador`,
  pelo que nenhum perfil ganha acesso a dados que não pudesse já obter.
- **Base de dados:** nenhuma. *(Nada a repetir no beta1 na promoção.)*

### Como validar

1. Entrar como `ofligacao`: **Arquivo** aparece na barra lateral e abre.
2. Confirmar que mostra ocorrências de **todas** as sub-regiões, não só a sua.
3. Filtrar por sub-região; depois por intervalo de datas; depois pelos dois.
4. **Limpar filtros** repõe a lista completa.
5. Confirmar que `gestor_sf` e os restantes perfis de módulo continuam sem o
   separador, e que `ofligacao` continua sem **Meios**.
6. Confirmar que as ocorrências fundidas continuam sem botão *Reabrir*.

---

## 6 — Reabrir ocorrência deixa de estar ao alcance do oficial de ligação

**Data:** 13/08/2026 · **Estado:** por validar

### O que muda

Reabrir uma ocorrência arquivada passa a ser acção do `admin` e do
`ofligacao_ccon`. O oficial de ligação regional continua a **fechar** a sua
ocorrência, mas já não a reabre.

Decorre da alteração 5: ao ganhar acesso ao arquivo, o `ofligacao` passaria a
poder reabrir qualquer ocorrência arquivada, de qualquer sub-região.

| Perfil | Fechar | Reabrir |
|---|---|---|
| `admin` | sim | **sim** |
| `ofligacao_ccon` | sim | **sim** |
| `ofligacao` | sim | **não** (antes sim) |
| `operacional`, `visualizador` | não | não |

### Três caminhos, não um

O botão do cartão do arquivo era o caminho óbvio, mas não o único:

1. **Cartão do arquivo** — `↩ Reabrir`, condicionado ao perfil.
2. **Ficha da ocorrência** — o botão `Fechar Ocorrência` transforma-se em
   `↩ Reabrir Ocorrência` quando a ocorrência está fechada. É o mesmo elemento,
   com a classe `auth-ofligacao`, pelo que continuava visível. Passa a ficar
   escondido quando está no modo Reabrir e o perfil não o pode fazer.
3. **A própria acção** — `reopenOcorrencia()` verifica antes de gravar, para o
   caso de se lá chegar por outra via.

### Imposição no servidor

`PATCH /api/ocorrencias/:id` recusa com **403** quando o estado passa a `active`
e o perfil não é `admin` nem `ofligacao_ccon`. A verificação só corre quando o
estado **muda de facto** — regravar uma ocorrência já activa não é uma
reabertura, e tratá-la como tal bloquearia edições correntes.

### Verificação feita

Contra a API do beta2, com uma ocorrência de teste fechada:

| Perfil | Resposta | Estado na base |
|---|---|---|
| `ofligacao` | **403** | continua `closed` |
| `ofligacao_ccon` | 200 | `active` |
| `admin` | 200 | `active` |

E `ofligacao` a gravar outro campo da mesma ocorrência: **200** — não afectado.
A ocorrência de teste foi eliminada no fim.

### Alterações

- `Gestao_Meios_v17.html` — `podeReabrir()`; cartão do arquivo, botão da ficha
  de detalhe e `reopenOcorrencia()` condicionados.
- `server.js` — guarda em `PATCH /api/ocorrencias/:id` para a transição para
  `active`.
- **Base de dados:** nenhuma. *(Nada a repetir no beta1 na promoção.)*

### Como validar

1. Como `ofligacao`, abrir o Arquivo: os cartões não têm `↩ Reabrir`.
2. Abrir uma ocorrência arquivada: não há botão de reabrir na ficha.
3. Confirmar que continua a poder **fechar** uma ocorrência activa sua.
4. Como `ofligacao_ccon` e como `admin`, confirmar que reabrem normalmente.

---

## 7 — MR seleccionáveis nas linhas de brigada; exclusão do que já está na carta

**Data:** 13/08/2026 · **Estado:** por validar

### O que muda

**As Máquinas de Rasto passam a constar do dropdown Código** das linhas de
BSBF Norte, BSBF Sul, GSBF e Outros Meios. Eram excluídas em dois pontos: a
lista de classes destas linhas não incluía `MR`, e o `fsbfViatOpts()` tinha um
ramo de recurso que retirava `MR` sempre que não fosse pedida uma classe
explícita. Ficam disponíveis **21 MR** — as activas, no dispositivo e
operacionais, de um total de 30.

**Nenhuma viatura pode ficar em dois pontos da carta do mesmo dia.** Passa a
haver um conjunto das viaturas já escolhidas, e o dropdown exclui-as.

### Porque a exclusão era necessária

O `em_uso` que o dropdown já usava significa *empenhada numa ocorrência* — vem
da tabela `meios` — e **não** *já usada nesta carta*. E não existe restrição na
base: `fsbf_bsbf_equipa` e `fsbf_emr_equipa` só têm chave primária e índice por
data, nada sobre `(data, veiculo_id)`. A mesma viatura podia portanto ficar em
duas linhas ao mesmo tempo.

O risco já existia para as outras classes, mas tornava-se muito mais provável
com as MR, que têm secção própria: **9 MR já estão em uso em cartões EMR**, e
sem a exclusão apareceriam também nas linhas de brigada.

### Âmbito do conjunto

Conta como usada uma viatura que esteja em qualquer destes pontos da carta do
dia: a coluna Código de uma linha de brigada, qualquer um dos quatro lugares de
um cartão EMR — MR, VAOP, piloto, VLCI — ou o veículo do Chefe de Grupo.

**A viatura da própria linha continua sempre visível**, tal como acontece com as
inoperacionais: se desaparecesse, gravar a linha apagava-a.

### Alterações

- `Gestao_Meios_v17.html` — `MR` acrescentada às classes das linhas de brigada;
  `fsbfViatUsadasNaCarta()` e `_fsbfViatUsadas`, calculados no
  `renderFsbfCarta()` antes de desenhar; exclusão aplicada em `fsbfViatOpts()`.
- **Servidor:** nenhuma.
- **Base de dados:** nenhuma. *(Nada a repetir no beta1 na promoção.)*

### Por decidir

A exclusão vive no cliente. Nada impede, pela API, gravar a mesma viatura em
duas linhas — nem existe índice único que o impeça. Se isso for para fechar, a
forma sólida é um índice `UNIQUE (data, veiculo_id)` mais uma verificação que
devolva 409, e vale entrada própria: há que decidir antes se alguma secção pode
legitimamente repetir uma viatura.

### Como validar

1. Numa linha de BSBF Norte, abrir o dropdown Código: devem aparecer MR.
2. Escolher uma MR e gravar; abrir o dropdown de outra linha: essa MR já não
   consta.
3. Abrir o cartão EMR que use essa MR: continua a mostrá-la como selecção.
4. Reabrir a linha que a tem: continua visível — não desaparece da sua própria
   linha.
5. Confirmar o mesmo para uma VFCI usada no Chefe de Grupo: não deve aparecer
   nas linhas de brigada.

---

## 8 — 2.º Comandante Nacional elegível para Coordenador de Dia e Chefe de Grupo

**Data:** 13/08/2026 · **Estado:** aplicado a beta1 e beta2

### O que muda

Os dois selectores do cabeçalho da Carta de Meios — **Coordenador de Dia** e
**Chefe de Grupo** — ofereciam apenas operacionais com `cargo = 'Chefe de
Grupo'`. O efectivo tem um **2.º Comandante Nacional**, José Motaco, que não
cabia nesse filtro e por isso não aparecia em lista nenhuma.

Os dois lugares passam a aceitar ambos os cargos.

| Cargo | Activos | Elegível para os dois lugares |
|---|---:|---|
| Chefe de Grupo | 6 | sim |
| 2.º Comandante Nacional | 1 | **sim** (antes não) |
| Sapador Bombeiro Florestal | 103 | não |
| Sapador Bombeiro Florestal Estagiário | 56 | não |
| (sem cargo) | 10 | não |

O `fsbfOpOpts()` passa a aceitar uma lista de cargos além de uma string, e os
cargos elegíveis ficam numa constante `CARGOS_COMANDO`, para não andarem
repetidos por vários pontos.

### Não alterado

O **Comandante da Força** da Gruata continua restrito a `Chefe de Grupo`. Não
foi pedido, e é um lugar distinto — se também dever aceitar o 2.º Comandante
Nacional, é trocar o argumento por `CARGOS_COMANDO`.

Os selectores de **chefe de equipa das linhas** continuam sem filtro de cargo:
oferecem todo o efectivo, como antes.

### Nota sobre o aviso de base

José Motaco é o único operacional activo **sem base** registada. O aviso de base
fora da linha não dispara para ele — sem base não há comparação possível, e é
tratado como desconhecido, não como divergência. Os dois lugares do cabeçalho
também não têm base de referência, pelo que a questão não se coloca aí.

### Alterações

- `Gestao_Meios_v17.html` — `CARGOS_COMANDO`; `fsbfOpOpts()` aceita string ou
  lista; os dois selectores do cabeçalho passam a usar a constante.
- **Servidor:** nenhuma. `coord_nome` e `chefe_nome` são texto livre e nunca
  foram validados contra o cargo.
- **Base de dados:** nenhuma.

### Como validar

1. Na Carta de Meios, abrir **Coordenador de Dia**: José Motaco consta da lista.
2. O mesmo em **Chefe de Grupo**.
3. Escolher, gravar e validar o bloco — o nome persiste e o contacto é
   preenchido automaticamente a partir do efectivo.
4. Confirmar que os restantes 169 operacionais continuam fora destes dois
   selectores.

---

## 9 — Editar Meio de composições BSF já não herda o estado do modal de Adicionar

**Data:** 16/08/2026 · **Estado:** aplicado a beta1 e beta2

### O sintoma

Ao editar o meio-pai de uma composição BSF, o modal aparecia sem os campos de
identificação e com a lista *«Os seguintes recursos serão adicionados
individualmente à ocorrência»* — texto que só faz sentido ao **criar**. Os
bloqueios da alteração 2 pareciam não estar a funcionar.

### A causa

O modal tem dois blocos alternativos: `single-meio-fields`, com Designação,
Tipo, Matrícula, Concelho, Responsável e Contacto, e `bsf-members-section`, a
pré-visualização dos membros de uma composição. O `applyPreset()` alterna entre
eles e o `openAddTeam()` repõe-nos — **mas o `editTeam()` nunca lhes tocava**.

Bastava abrir *Adicionar Meio*, escolher uma composição BSF e fechar: o modal
ficava com a pré-visualização visível e os campos de identificação escondidos.
Abrir *Editar Meio* a seguir herdava esse estado. Os campos de identificação
continuavam bloqueados pela alteração 2 — só que **escondidos**, e portanto os
bloqueios não se viam.

Editar um meio existente nunca deve mostrar a pré-visualização: os filhos já
existem, não vão ser criados.

### O que muda

O `editTeam()` repõe os dois blocos e limpa `team-bsf-id`, tal como o
`openAddTeam()` já fazia. As três funções que mexem nestes blocos ficam
coerentes.

### Alterações

- `Gestao_Meios_v17.html` — reposição de `bsf-members-section`,
  `single-meio-fields` e `team-bsf-id` no início do `editTeam()`.
- **Servidor:** nenhuma. **Base de dados:** nenhuma.

### Como validar

1. Abrir **Adicionar Meio**, escolher uma composição BSF, **Cancelar**.
2. Abrir **Editar Meio** num meio qualquer: devem aparecer Designação, Tipo,
   Matrícula e Concelho — a cinzento tracejado — e **não** a lista de membros.
3. Editar o pai de uma composição: idem, com os campos de identificação
   bloqueados e os das fases já cumpridas em leitura.
4. Confirmar que Adicionar continua a mostrar a pré-visualização ao escolher uma
   composição BSF.

---

## 10 — Violações de restrição deixam de ser 500 e de bloquear a fila

**Data:** 16/08/2026 · **Estado:** por validar — **apenas no beta2**

### O sintoma

A sincronização falhava em ciclo, sempre com o mesmo erro:

```
POST /api/meios_eventos 500 (Internal Server Error)
syncNow failed op: meios_eventos insert
  violates foreign key constraint "meios_eventos_meio_id_fkey"
```

### A causa

Um evento em fila apontava para um meio que já não existe — por ter sido
eliminado entretanto, directamente ou por cascata ao remover o meio-pai. A
inserção viola a chave estrangeira `meios_eventos.meio_id → meios(id)`.

O `wrap()` do servidor devolvia **500** para qualquer excepção. E o `syncNow()`
descarta a operação em **4xx**, mas trata tudo o resto como falha temporária e
volta a tentar. Um 500 permanente tornava-se assim um ciclo infinito: a operação
nunca saía da fila e **bloqueava a sincronização de tudo o resto**.

O erro estava do lado certo — os dados do pedido é que não servem — mas era
comunicado como avaria do servidor.

### O que muda

**No servidor**, o `wrap()` passa a traduzir os códigos de erro do PostgreSQL:

| Código | Resposta | Mensagem |
|---|---|---|
| `23503` chave estrangeira | **409** | O registo a que esta operação se refere já não existe. |
| `23505` unicidade | 409 | Já existe um registo com estes valores. |
| `23514` restrição CHECK | 409 | Valor fora do permitido para este campo. |
| `23502` NOT NULL | 400 | Falta um campo obrigatório. |
| `22P02` formato inválido | 400 | Identificador ou valor com formato inválido. |

Tudo o resto continua a ser 500. Os pontos que já tratavam `23505` com mensagem
própria continuam a apanhá-lo primeiro, e mantêm o seu texto.

Isto fecha também um caso que ficara assinalado antes: uma violação de `CHECK` —
como o limite de guarnição — saía como 500 com o texto cru da restrição.

**No cliente**, cada operação em fila passa a contar tentativas e é descartada
ao fim de **8**. Um 4xx continua a ser descartado logo; o contador existe para
que nenhum erro imprevisto volte a poder bloquear a fila indefinidamente.

### Efeito nas operações já presas

Assim que o beta2 servir esta versão, a próxima sincronização recebe 409 nessas
operações e descarta-as, com aviso de *«operações rejeitadas e descartadas»*.
Não é preciso limpar a fila à mão.

### Verificação feita

Contra a API do beta2:

| Pedido | Antes | Agora |
|---|---|---|
| Evento para um meio inexistente | 500, repetido sem fim | **409**, descartado |
| `meio_id` sem formato de UUID | 500 | **400** |
| Evento válido | 200 | 200 |

O evento de teste foi removido no fim.

### Alterações

- `server.js` — `ERROS_PG` e tradução no `wrap()`.
- `Gestao_Meios_v17.html` — `QUEUE_MAX_TENTATIVAS`, contador em `pushToQueue()`,
  `updateQueueItem()`, e desistência no `catch` do `syncNow()`.
- **Base de dados:** nenhuma.

### Como validar

1. Confirmar que a sincronização deixa de repetir o erro e a fila esvazia.
2. Confirmar que operações legítimas continuam a sincronizar.
3. Provocar um erro conhecido — por exemplo gravar guarnição 10 pela API — e
   confirmar que devolve 409 com mensagem legível, e não 500.

---

## 11 — Operacionais deixam de ser contados a dobrar em meios compostos

**Data:** 16/08/2026 · **Estado:** por validar — **apenas no beta2**

### O problema

Num meio composto, pai e filhos guardam **ambos** um número de operacionais, e
todos os totais somavam os dois. Medido no beta2: `BRIG 01-115` contava **30**
operacionais quando são **15**.

| Via | Pai | Filhos | Duplicava |
|---|---|---|---|
| **BSF** (composição) | soma dos membros | `num_elementos` de cada | sim |
| **BSBF** (deploy) | soma das guarnições da carta | `guarnicao` de cada | sim |
| **EMR** (deploy) | `total_op` do cartão | coluna não preenchida | não |

### A regra adoptada

Cada tipo tem a sua fonte de verdade, e é essa que conta:

- **BSF** — contam os **filhos**. O pai é um contentor com a soma; os filhos são
  o detalhe real, um por membro.
- **BSBF** — conta o **pai**. O seu número é a soma das guarnições das linhas da
  **Carta de Meios** dessa brigada.
- **EMR** — conta o **pai**. O seu número é o `total_op` do cartão da **Carta de
  Meios**; os filhos (VAOP, piloto, VLCI) não trazem número nenhum.

Um pai de composição **sem filhos** continua a contar: de outro modo uma
composição por completar desaparecia da contagem.

### Onde se aplica

Um só par de funções — `meioContaOperacionais()` e `somaOperacionais()` — e
**20 somatórios** passaram a usá-lo: resumo da ocorrência, cartões de posto de
comando, estatísticas por tipologia (ESF, BSF, FSBF, EMR, EGFR), totais das
listas de ocorrências, arquivo, cabeçalho da listagem de meios e agrupamento por
sector.

### Verificação

| Caso | Total | Esperado |
|---|---:|---:|
| BSF: pai 15 + 3 filhos de 5 | 15 | 15 |
| BSBF: pai 15 + 3 filhos de 5 | 15 | 15 |
| EMR: pai 6 + 3 filhos sem número | 6 | 6 |
| Dois meios simples (4+7) | 11 | 11 |
| Composição BSF sem filhos | 12 | 12 |
| Subconjunto só com o filho | 5 | 5 |
| Filho com o pai fora do conjunto | 5 | 5 |

Os dois últimos importam porque há somatórios sobre subconjuntos — por posto de
comando, por sector. Nesses casos a procura do pai é feita sobre `db.teams`
inteiro, e um filho cujo pai não esteja no conjunto conta, em vez de se perder.

### Alterações

- `Gestao_Meios_v17.html` — `meioContaOperacionais()`, `somaOperacionais()`, e
  os 20 somatórios.
- **Servidor:** nenhuma. Os dois números continuam gravados: o do pai é o
  resumo, o dos filhos o detalhe. Só a leitura mudou.
- **Base de dados:** nenhuma.

### Como validar

1. Numa ocorrência com uma composição BSF, confirmar que o total de operacionais
   passa a ser metade do que mostrava.
2. Conferir contra a Carta de Meios: numa brigada BSBF, o total deve igualar a
   soma das guarnições das linhas desse dia.
3. Num cartão EMR, o total deve igualar o Total Op. do cartão.
4. Confirmar que ocorrências sem meios compostos mantêm exactamente o mesmo
   número de antes.

---

## 12 — Editar Meio passa a propagar o estado ao conjunto composto

**Data:** 16/08/2026 · **Estado:** por validar — **apenas no beta2**

### O sintoma

Passar a MR **M01** a *Em Operação* deixou os seus três meios agregados —
VAOP 03, VLCI 11 e VTTP 02 — em *Em Trânsito*. Nada foi perguntado sobre o
resto do conjunto.

### A causa

As **acções rápidas** já tratam disto: quando o meio pertence a um conjunto,
mostram a caixa *«aplicar a todos»*, ligada por omissão, e propagam. São oito —
trânsito, operação, descanso, desmobilização, chegada à base, sector, posto e
transferência.

O **Editar Meio** não tinha nada disso. O `saveTeam()` nunca chama
`compositeGroupSiblings()`: gravava apenas o meio aberto. Mudar o estado por ali
movia o pai e deixava os filhos para trás, sem aviso.

### O que muda

Quando o meio pertence a um conjunto, o modal de edição passa a mostrar, por
baixo do selector de estado, a mesma opção das acções rápidas:

> ☑ Aplicar a mudança de estado aos **3** meios de *Máquina de Rasto M01*

Ligada por omissão, e só visível quando há conjunto. Ao gravar, se o estado
mudou e a opção estiver ligada, a alteração é aplicada aos restantes.

A propagação **reutiliza os aplicadores das acções rápidas** —
`applyTransitToTeam`, `applyOpToTeam`, `applyRestToTeam`, `applyDemobToTeam` —
para que o resultado seja idêntico venha a alteração de onde vier: as mesmas
datas e horas da fase, o mesmo sector e missão, o mesmo recálculo do limite
operacional por meio. Um meio que já esteja no estado de destino é ignorado.

### Âmbito

Propaga-se a **mudança de estado**. Os restantes campos da edição continuam a
aplicar-se só ao meio aberto — designação, matrícula, contacto e observações são
próprios de cada um, e copiá-los ao conjunto seria errado.

O conjunto resolve-se nos dois sentidos, como já acontecia nas acções rápidas:
a partir do pai dá os filhos; a partir de um filho dá o pai e os irmãos.

### Verificação

Com o conjunto de M01 (pai + VAOP 03, VLCI 11, VTTP 02) e um meio solto:

| A partir de | Conjunto encontrado |
|---|---|
| M01 (pai) | VAOP 03, VLCI 11, VTTP 02 |
| VAOP 03 (filho) | M01, VLCI 11, VTTP 02 |
| SF 5VN05 (solto) | nenhum — sem caixa |

### Alterações

- `Gestao_Meios_v17.html` — `propagarEstadoAoGrupo()`; caixa `team-aplicar-grupo`
  desenhada pelo `editTeam()` no novo contentor `team-grupo-nota`; chamada no
  `saveTeam()` onde a mudança de estado já era detectada.
- **Servidor:** nenhuma. **Base de dados:** nenhuma.

### Como validar

1. Numa MR com agregados, abrir **Editar Meio**: a caixa aparece com a contagem
   correcta, ligada.
2. Mudar o estado e gravar: os agregados acompanham, e surge o aviso *«Estado
   aplicado a mais N meio(s) do conjunto.»*
3. Repetir com a caixa desligada: só o meio aberto muda.
4. Num meio sem agregados, confirmar que a caixa não aparece.
5. Confirmar que alterar só o contacto ou as observações não mexe nos agregados.

---

## 13 — Uma composição não pode ser empenhada duas vezes

**Data:** 16/08/2026 · **Estado:** por validar — **apenas no beta2**

### O que aconteceu

`BRIG 01-115` foi empenhada **três vezes na mesma ocorrência**, com um minuto de
intervalo, cada uma com os mesmos três sapadores:

```
14:16:14  BRIG 01-115  transito   SF 39-115, SF 40-115, SF 41-115
14:17:13  BRIG 01-115  transito   SF 39-115, SF 40-115, SF 41-115
14:18:09  BRIG 01-115  operacao   SF 39-115, SF 40-115, SF 41-115
```

Nove filhos, para três recursos.

### Porque nada o impediu

A exclusividade assenta em índices únicos parciais sobre `recurso_id` e
`viatura_id`, mas cobrem apenas três estados:

```sql
WHERE recurso_id IS NOT NULL AND estado IN ('transito','operacao','descanso')
```

Falta `previsto` — e é nesse estado que os filhos de uma composição nascem.
Uma brigada acabada de despachar **não ocupava nada**, e o `23505` que o deploy
apanha nunca chegava a disparar.

A aplicação, essa, considera `previsto` ocupado:
`OCUPADO_ESTADOS = ['previsto','transito','operacao','descanso']`. O índice e a
regra da aplicação discordavam, e a discordância era exactamente a brecha.

### O que muda

O deploy de composição passa a recusar, com **409**, quando a composição já tem
um empenhamento não desmobilizado, nomeando onde está:

> Esta composição já está empenhada na ocorrência "Faro, Loulé, Salir" (operacao).

### Verificação

| Caso | Resultado |
|---|---|
| Empenhar uma composição já activa | **409**, com a ocorrência nomeada |
| Empenhar uma composição livre (`BRIG 02-16C`) | 200, pai e filhos criados |

O empenhamento de teste foi removido, e os filhos foram com ele por cascata.

### Por fazer — a correcção de fundo

O ideal é alinhar os índices com `OCUPADO_ESTADOS`, acrescentando `previsto`:
fecharia a brecha para **todos** os meios, não só para composições. Não pode ser
feito já: os duplicados existentes violam a restrição e a criação do índice
falharia. Exige limpar os dados primeiro, e fica como entrada própria.

### Alterações

- `server.js` — verificação no `POST /api/ocorrencias/:id/meios/composicao`.
- **Base de dados:** nenhuma *(a alteração aos índices fica por decidir)*.

### Como validar

1. Empenhar uma brigada BSF numa ocorrência.
2. Tentar empenhar a mesma outra vez, na mesma ou noutra ocorrência: deve
   recusar, nomeando onde já está.
3. Desmobilizá-la e confirmar que volta a poder ser empenhada.

---

## 14 — Conjuntos compostos: contentor, acções de grupo, destacar e reagrupar

**Data:** 16/08/2026 · **Estado:** por validar — **apenas no beta2**

### O contentor não é um meio

Numa **BSF** e numa **BSBF**, o pai é o rótulo do conjunto — não uma viatura nem
uma equipa. Numa **EMR**, o pai *é* um meio: a própria máquina de rasto.

A distinção é feita pela origem — `composicao_id` ou `fsbf_bsbf_id` indicam
contentor, `fsbf_emr_id` indica meio — e não pelo `tipo`, que a edição pode
apagar, nem pela viatura, que só 1 dos 3 pais EMR tem.

| | Conta como meio | Conta operacionais |
|---|---|---|
| Contentor BSF | não | não (contam os filhos) |
| Contentor BSBF | não | sim (número da carta) |
| MR de uma EMR | **sim** | sim (`total_op`) |

O crachá do conjunto passa a contar **meios**, não filhos: uma EMR mostra
**⬡ 4** — MR, VAOP, VTTP e VLCI — onde antes mostrava 3. Um contentor mostra o
número das suas viaturas.

Na ocorrência de Faro a contagem passa de **18 para 16** meios.

### Pertença visível no cartão

A vista por estado separa o conjunto quando os estados divergem, e o `└`
sozinho não diz a que conjunto o meio pertence. Cada membro passa a mostrar um
crachá com o nome do conjunto — `⬡ BSBF Sul` — na cor do grupo, visível onde
quer que o cartão apareça.

### As acções são do conjunto

Num membro agrupado desaparecem **Estado**, **Setor**, **Posto** e **Remover**:
essas acções pertencem ao cartão do conjunto, onde já propagam. Continuam
disponíveis **Ficha Meio**, **✎ Editar** e observações — o que é próprio de cada
viatura.

### Destacar e reagrupar

- **⇤ Destacar** retira o meio do conjunto. Recupera as suas acções
  individuais, passa a contar por si, e o crachá indica *destacado*.
- **⇥ Reagrupar** devolve-o. Se estiver noutro estado, é proposto alinhá-lo com
  o conjunto.

Guarda-se um sinalizador `destacado` em vez de anular `meio_pai_id`: sem o elo
perdia-se a origem e não haveria a que voltar. *Agrupado* passa a ser
`meio_pai_id IS NOT NULL AND NOT destacado`.

**O efectivo acompanha.** O contentor guarda o número vindo da Carta de Meios,
pelo que destacar desconta o membro e reagrupar repõe — de outro modo passaria a
ser contado duas vezes. Verificado no beta2, ida e volta:

```
inicial   BSBF Sul = 12 op.   filho = 2 op.   destacado=false
destacar  200 → contentor = 10 op.            destacado=true
repetir   409 · Este meio já está destacado.
reagrupar 200 → contentor = 12 op.            destacado=false
```

Um meio destacado **sobrevive à remoção do contentor**: o elo é cortado antes,
para que o `ON DELETE CASCADE` não o leve.

### Alterações

- `server.js` — coluna `destacado`; `POST /api/meios/:id/destacar` e
  `/reagrupar`, em transacção e com `FOR UPDATE`; corte do elo dos destacados
  antes de eliminar o contentor.
- `Gestao_Meios_v17.html` — `meioAgrupado()`, `filhosAgrupados()`,
  `meioEhContentor()`, `meiosDoConjunto()`, `somaMeios()`; contagens de meios;
  crachá do conjunto; acções de grupo escondidas nos membros; `destacarMeio()` e
  `reagruparMeio()`.
- **Base de dados:** a coluna é criada pelas migrações no arranque. Ao promover
  ao beta1, o mesmo acontece automaticamente — nada a correr à mão.

### Por decidir

A caixa **«aplicar a todos»** das acções rápidas perde sentido agora que os
membros não têm acções próprias: desligá-la separa o conjunto sem forma de o
voltar a juntar pelos cartões dos membros. Proponho retirá-la e propagar sempre,
ficando **destacar** como a forma deliberada de mover um meio sozinho.

### Como validar

1. Numa EMR, confirmar **⬡ 4**; numa BSF/BSBF, o número de viaturas.
2. Confirmar que o total de meios da ocorrência desce (Faro: 18 → 16).
3. Num membro agrupado: sem Estado/Setor/Posto/Remover, com Ficha e Editar.
4. **Destacar** um membro: recupera as acções, o contentor perde o seu efectivo,
   e o crachá diz *destacado*.
5. **Reagrupar**: o efectivo volta e é proposto alinhar o estado.
6. Confirmar que o crachá do conjunto aparece nos membros em qualquer secção de
   estado, mesmo com o conjunto dividido.

---

## 15 — Viatura de um meio EGFR atribuível depois do despacho

**Data:** 16/08/2026 · **Estado:** por validar — **apenas no beta2**

### Porque nasciam sem viatura

O despacho EGFR não pergunta a viatura: lê-a da escala.

```sql
SELECT ev.viatura_id, v.viatura_cod, v.matricula, v.classe
  FROM egfr_viatura ev LEFT JOIN viaturas v ON v.id = ev.viatura_id
 WHERE ev.data=$1 AND ev.equipa=$2
```

Não encontrando nada, recorre a valores por omissão: `eq` fica o nome da equipa,
`tipo` fica `EGFR`, e `viatura_id` e `matricula` ficam nulos.

**Os cinco meios EGFR já empenhados estão todos assim**, porque a tabela
`egfr_viatura` tem 3 linhas e **as três têm `viatura_id` nulo** — a escala de
viaturas nunca foi preenchida. Não era um passo saltado no despacho: não havia
viatura para encontrar.

### O que muda

Um meio EGFR passa a ter, no cartão, **🚗 Atribuir viatura** quando não a tem, e
**🚗 Viatura** quando tem — para trocar ou retirar. Sem viatura, o cartão mostra
o crachá **🚗 sem viatura**; com ela, a matrícula ao lado do nome.

**A designação não muda.** `eq` continua a ser o nome da equipa — já está na
Fita do Tempo — e a viatura aparece ao lado, não em vez dele.

Ao atribuir, é oferecido **gravar também na escala EGFR do dia**, para que os
despachos seguintes já a levem. É a correcção na origem, e fica a um clique.

### Decisões aplicadas

- **Sem filtro de dispositivo.** Não existe uma única viatura de classe `EGFR` ou
  `VGFR`; o que há são **76 VCOT e 6 sem classe com `megfr='EGFR'`**, e **nenhuma
  marcada como dispositivo**. Exigi-lo daria uma lista vazia.
- **Podem atribuir:** `ofligacao`, `ofligacao_ccon` e `admin`.
- **Retirar** existe, e devolve o `tipo` a `EGFR`, como o despacho faz sem viatura.

### Lista própria, e porquê

`/api/gestao/viaturas` exige um perfil de módulo — um `ofligacao` recebe 403.
Foi criado `GET /api/viaturas/egfr`, restrito a `megfr='EGFR'` e legível a partir
de `ofligacao`, em vez de alargar o acesso a toda a frota.

### A exclusividade é verificada na atribuição

Os índices únicos e o `findViaturaConflict` protegiam o despacho, não uma
atribuição posterior. Sem esta verificação, isto seria uma nova via para
empenhar a mesma viatura duas vezes. Também se recusa uma viatura inoperacional.

### Verificação no beta2, com o `EGFR 03` real

| Passo | Resultado |
|---|---|
| Lista para `ofligacao` | 200 · 82 viaturas |
| Lista para `operacional` | **403** |
| Atribuir | 200 · `eq` mantém-se `EGFR 03`, matrícula `04-74-UM`, viatura ligada |
| Escala do dia | gravada |
| Atribuir a mesma outra vez | 200 (é a própria — o conflito exclui-se a si) |
| Retirar | 200 · `tipo` volta a `EGFR`, matrícula limpa |
| Retirar de novo | **409** · «não tem viatura atribuída» |

A escala de teste foi revertida no fim.

### Consequência visível a confirmar

Ao atribuir, o `tipo` passa a ser a classe da viatura — `VCOT` no teste. É
exactamente o que o despacho faz quando a escala **tem** viatura, pelo que é
coerente; mas o crachá de tipo deixa de dizer `EGFR`. Se preferir que o tipo se
mantenha `EGFR`, é retirar `tipo` do `UPDATE`.

### Alterações

- `server.js` — `GET /api/viaturas/egfr`, `POST /api/meios/:id/viatura`,
  `DELETE /api/meios/:id/viatura`.
- `Gestao_Meios_v17.html` — `abrirViaturaEgfr()`, `atribuirViaturaEgfr()`,
  `retirarViaturaEgfr()`; botão no cartão; crachás de viatura.
- **Base de dados:** nenhuma alteração de esquema. Atribuir escreve em
  `egfr_viatura`, que é dado corrente.

### Como validar

1. No `EGFR 03`, confirmar o crachá **🚗 sem viatura** e o botão de atribuir.
2. Atribuir: a matrícula aparece ao lado do nome, a designação não muda.
3. Confirmar na escala EGFR do dia que a viatura ficou gravada.
4. Tentar atribuir a mesma viatura a outro meio activo: deve recusar.
5. Retirar e confirmar que volta a **sem viatura**.

---

## 16 — Modais de Adicionar/Editar Meio: ordem das caixas, limites de operação e botão de operacionais

**Data:** 18/08/2026 · **Estado:** por validar

### O que muda

Três correcções ao modal de meio, pedidas depois de o usar a sério.

**a) Ordem das caixas.** Estava *Identificação → Mobilização → Operação*, o que
obrigava a saltar para baixo para escolher o estado e voltar acima para as
datas que esse estado destranca. Passa a *Identificação → Operação →
Mobilização*: escolhe-se primeiro o estado, e a Mobilização abre já com os
campos certos à vista.

**b) Tempo máximo op. e Limite Op. (hora) só a partir da chegada ao TO.**
Apareciam sempre, mesmo num meio ainda *Previsto* — pedia-se um limite de
operação a um meio que nem tinha saído. Passam a seguir a mesma regra dos
campos de Chegada ao TO: aparecem quando o estado é **Em Operação**, Em
Descanso ou Desmobilizado, logo a seguir a esses campos. Em modo de edição
continuam visíveis, como os restantes campos de mobilização.

**c) Observações / Eventos passa a grupo próprio.** Era um campo perdido no fim
da caixa Operação. Passa a secção com título, depois de Operacionais.

**d) O botão «+ Adicionar operacional» deixa de funcionar uma só vez.** Era o
defeito mais incómodo: com o Nº Operacionais vazio, o primeiro clique
acrescentava a linha **e escrevia 1 no campo** — e esse 1 passava a ser tratado
como tecto, pelo que todos os cliques seguintes só produziam *«Limite de 1
operacionais atingido»*. O campo passa a acompanhar a lista em vez de a travar,
que é o que o botão equivalente do PM (`addPMOpsField`) já fazia.

Ao remover o tecto desapareceu também `_updateOpsAddBtn()`, que tinha um
segundo defeito: `document.querySelector('.ops-add')` devolve o **primeiro**
botão com essa classe no documento — o do PM, que está mais acima no modal.
Ou seja, desactivava visualmente o botão errado.

**e) Anos de mais de 4 dígitos nos campos de data.** Um `<input type="date">`
aceita anos até 275760: escrever `20266` em vez de `2026` passava despercebido
e só se notava depois, nas durações e na ordenação. Todos os campos de data da
aplicação (21) passam a ter `min`/`max` e a recusar, com aviso, um ano fora de
2000–2100.

### Alterações

- `Gestao_Meios_v17.html`
  - Modal `modal-team`: bloco **Operação** movido para antes de **Mobilização**;
    `Tempo máximo op.` e `Limite Op. (hora)` embrulhados em
    `mob-fld-horas-max` / `mob-fld-limite-op`; `team-obs` movido para uma
    secção **Observações / Eventos** depois de Operacionais.
  - `toggleMobilizacaoFields()` — passa a comandar os dois novos invólucros
    pela condição `hasChegad`.
  - `addOpsField()` — acrescenta sempre; `team-ops` acompanha a lista.
  - `_updateOpsAddBtn()` — removida, com as suas 4 chamadas.
  - Novo guarda global de datas (`DATA_MIN`/`DATA_MAX` + `focusin`/`change`).
- **Base de dados:** nenhuma alteração. Nada a repetir à mão numa promoção.

### Verificação feita

`addOpsField` e `syncOpsFields` foram extraídas do ficheiro e corridas em Node
contra um DOM mínimo:

| Cenário | Resultado |
|---|---|
| Lista vazia, 5 cliques seguidos | 5 linhas, Nº Operacionais = 5 |
| Escrever 3, depois 2 cliques | 5 linhas, Nº = 5 |
| Escrever 2 tendo 5 linhas | reduz a 2 linhas |

O ficheiro passa à verificação de sintaxe do bloco `<script>`.

### Como validar

1. Abrir **Adicionar Meio**: a caixa **Operação** aparece logo depois de
   Identificação.
2. Com o estado em *Previsto*, confirmar que **Tempo máximo op.** e **Limite
   Op. (hora)** não aparecem; escolher **Em Operação** e confirmar que surgem a
   seguir a Data/Hora Chegada TO.
3. Confirmar **Observações / Eventos** como secção, depois de Operacionais.
4. Com o Nº Operacionais vazio, clicar **+ Adicionar operacional** quatro ou
   cinco vezes: deve acrescentar sempre, e o número deve acompanhar.
5. Num campo de data, tentar escrever um ano de 5 dígitos: o campo limpa-se e
   avisa.
6. Editar um meio já em operação e confirmar que os bloqueios por fase se
   mantêm (os campos de fases anteriores continuam trancados).

---

## 17 — Nomes dos operacionais legíveis no tema claro

**Data:** 18/08/2026 · **Estado:** por validar

### O que muda

Os crachás com os nomes dos operacionais no cartão do meio — bem visíveis nos
EGFR, que trazem a guarnição nomeada da escala — apareciam **pretos sobre
pretos** no tema claro.

A causa é uma mistura de fundo fixo com cor variável: `.operative-chip` tinha
`background:rgba(37,39,32,.8)`, escrito à mão e sempre escuro, mas
`color:var(--text)`, que no tema claro passa a `#1a2a1a`. No tema escuro os
dois davam-se bem; ao mudar de tema só um deles mudava.

O fundo passa a vir de `var(--surface2)` no tema claro, pela mesma via que já
era usada para `.badge-closed` e `.schema-block`.

| Tema | Contraste antes | Contraste depois |
|---|---|---|
| Claro | 1.85:1 (ilegível) | **12.91:1** |
| Escuro | 12.07:1 | 12.07:1 (inalterado) |

### Alterações

- `Gestao_Meios_v17.html` — uma regra: `html.theme-light .operative-chip`.
- **Base de dados:** nenhuma alteração.

### Como validar

1. Passar ao tema claro, abrir uma ocorrência com um EGFR empenhado.
2. Confirmar que os nomes da guarnição se leem no cartão do meio.
3. Voltar ao tema escuro e confirmar que continua igual ao que era.

### Encontrado ao lado, por corrigir

`.tl-cat-outros` (filtro «Outros» da Fita do Tempo) tem exactamente o mesmo
defeito, embora menos gritante: fundo escuro fixo com `color:var(--muted)`, o
que no tema claro dá **1.61:1**. Não foi mexido por estar fora do que foi
pedido.

---

## 18 — Conjuntos compostos recolhidos dentro do cartão do pai

**Data:** 18/08/2026 · **Estado:** por validar

### O que muda

Nas vistas de **Cartões** e de **Sector**, os meios de um conjunto composto
deixam de ocupar cartões soltos ao lado do pai. O conjunto passa a ser **um
único item da grelha**: o cartão do pai, com um botão `⬡ N meios` que abre e
fecha os membros. Por omissão vem **fechado** — quatro cartões passam a um.

Antes os filhos eram irmãos na mesma grelha CSS, apenas indentados 20 px com um
`└`. Não havia contenção nenhuma; agora há.

Isto resolve também uma questão que estava em aberto: o contentor de uma BSF ou
BSBF, que não é um meio, deixa de ser um quarto cartão estranho e passa a ser o
cabeçalho do conjunto — que era o que sempre foi.

### O que o cartão fechado mostra

Recolher não pode esconder o que interessa, por isso o cabeçalho passa a dizer:

- **quantos meios** estão neste cartão (`⬡ 3 meios`);
- **em que estados** — `2 em op. · 1 trânsito`;
- **o efectivo do conjunto**;
- **o membro mais perto do limite de operação**, com a barra de tempo — e o
  cartão acende a vermelho (`.urgent`) se algum membro estiver acima de 85%.
  Sem isto, recolher escondia o aviso e era perigoso;
- 🔒 se algum membro tiver pedido de remoção pendente.

### Decisões

- **Fechado por omissão**, memorizado por conjunto em `localStorage`.
- **Aberto ocupa a linha toda** (`grid-column:1/-1`), para os membros caberem
  lado a lado em vez de espremidos numa coluna.
- **Vista de tabela não muda** — tem o seu próprio esquema de indentação.

### Armadilhas tratadas

1. **`renderTeams()` reconstrói o `innerHTML` de 60 em 60 segundos.** Um
   `<details>` fechava-se sozinho a cada minuto enquanto alguém o lia. O estado
   aberto/fechado vive em `_conjuntosAbertos`, fora do DOM, e é reaplicado a
   cada desenho.
2. **Um meio destacado não recolhe.** Usa-se `filhosAgrupados()`, que exclui os
   `destacado` — um meio destacado está deliberadamente sozinho.
3. **Um conjunto pode estar repartido por blocos.** Na vista por sector há
   blocos separados para previstos, trânsito e cada sector; três conjuntos
   antigos (criados a 14/08, antes da alteração 12) têm o pai num estado e os
   filhos noutro. Recolhe-se só o que está no mesmo bloco, e o cabeçalho avisa
   `+N noutro bloco`. Nunca se muda um meio de bloco para o pôr ao pé do pai:
   seria dizer que está num estado em que não está.
4. **O efectivo soma-se sobre o conjunto todo, contentor incluído.** Quem
   guarda o número muda com a origem — na BSF são os filhos, na BSBF e na EMR é
   o pai. Somar só os meios daria **zero numa BSBF**.

### Alterações

- `Gestao_Meios_v17.html`
  - CSS `.conjunto`, `.conjunto.aberto`, `.conjunto-filhos`, `.conjunto-toggle`.
  - `_conjuntosAbertos`, `toggleConjunto()`, `resumoConjunto()`,
    `gridConjuntos()`, `conjuntoCardHtml()`.
  - `teamCardHtml()` — novo 4.º argumento `opts` (`conjunto` para o cabeçalho,
    `semIndent` para os filhos já dentro da caixa); a urgência passa a incluir a
    do pior membro.
  - Os 4 pontos que emitiam `<div class="teams-grid">` passam por
    `gridConjuntos()`.
- **Base de dados:** nenhuma alteração.

### Verificação feita

Funções extraídas do ficheiro e corridas em Node com dados com a forma dos
reais do beta2:

| Cenário | Resultado |
|---|---|
| Conjunto uniforme, fechado | 1 item de grelha, filhos não desenhados, `aqui=3` |
| Expandido | caixa de filhos com os 3, sem indentação, classe `aberto` |
| Pai em trânsito e filhos previstos (caso real) | não agrupa; cada bloco desenha o que tem |
| 2 dos 3 filhos no bloco | `aqui=2 · total=3` → avisa `+1 noutro bloco` |
| Filho destacado | fica fora do conjunto e desenha-se à parte |
| Efectivo BSF / BSBF / EMR | 15 / 12 / 6 — certos nos três |
| Filho a 93% com o conjunto fechado | cabeçalho marcado urgente |

### Como validar

1. Abrir uma ocorrência com uma BSF: deve ver **um** cartão `BRIG …` com
   `⬡ 3 meios`, e não quatro cartões.
2. Clicar no botão: o conjunto abre a toda a largura com os três meios dentro.
3. Esperar mais de um minuto com o conjunto aberto — deve continuar aberto.
4. Recarregar a página: deve continuar aberto (fica memorizado).
5. Destacar um membro: sai da caixa e passa a cartão próprio.
6. Confirmar o efectivo do cabeçalho na BSBF (não pode aparecer 0).
7. Repetir na vista por **Sector**.

---

## 19 — A guarnição da Carta de Meios passa a chegar ao meio (BSBF e EMR)

**Data:** 18/08/2026 · **Estado:** por validar

### O que muda

Abrir **Editar Meio** numa BSBF mostrava `N.º Operacionais = 12` e doze caixas
de nome **vazias**. O mesmo na Ficha do Meio e nos crachás do cartão.

A causa não estava na leitura: estava no despacho. A guarnição escolhida na
Carta de Meios vive em `fsbf_equipa_membros`, e o despacho nunca a copiava para
`meios_operativos`. Copiava só o **chefe**, tirado de `chefe_nome`:

| Despacho | O que gravava antes |
|---|---|
| EGFR | a escala toda — **o único que estava certo** |
| EMR | só o chefe (1 nome) |
| BSBF | só o chefe de cada viatura (1 nome); o contentor, nenhum |
| Gruata / composições SF | nada |

Passa a copiar a guarnição inteira, chefe primeiro, mantendo o contacto ao lado
do nome do chefe como antes. Se não houver guarnição registada, mantém-se o
chefe — nunca fica pior do que estava.

O contentor da BSBF recebe a união das guarnições das suas viaturas: é ele que
guarda o efectivo da brigada (ver `meioContaOperacionais`), pelo que é nele que
a lista de nomes faz sentido — e era exactamente o cartão que aparecia vazio.

### Alterações

- `server.js`
  - `lerGuarnicao()` e `gravarOperativos()` — a coluna de ligação é validada
    contra uma lista fixa (`GUARNICAO_COLS`), por ser interpolada na consulta.
  - `POST /deploy/fsbf-emr` — guarnição da EMR no MR, com recurso ao chefe.
  - `POST /deploy/fsbf-bsbf` — guarnição por viatura em cada filho, e a união no
    contentor.
- **Base de dados:** sem alteração de esquema, mas **com correcção de dados**
  (ver abaixo) — esta parte **não viaja com o ramo** e teria de ser repetida no
  beta1.

### Correcção de dados aplicada ao beta2

Os meios já despachados não se corrigem sozinhos. Correu-se, numa transacção,
sobre os meios **activos** cuja lista tinha **no máximo um nome** (ou seja, os
que só tinham o chefe posto pelo despacho — não se tocou em nada escrito à mão):

```sql
BEGIN;
CREATE TEMP TABLE alvo AS
  SELECT m.id, m.fsbf_bsbf_id, e.contacto
  FROM meios m JOIN fsbf_bsbf_equipa e ON e.id = m.fsbf_bsbf_id
  WHERE m.meio_pai_id IS NOT NULL AND m.estado <> 'desmobilizado'
    AND (SELECT count(*) FROM meios_operativos o WHERE o.meio_id=m.id) <= 1;
DELETE FROM meios_operativos WHERE meio_id IN (SELECT id FROM alvo);
INSERT INTO meios_operativos (meio_id, nome, ordem)
SELECT a.id,
       CASE WHEN em.is_chefe AND a.contacto IS NOT NULL
            THEN op.nome||' ('||a.contacto||')' ELSE op.nome END,
       row_number() OVER (PARTITION BY a.id
                          ORDER BY em.is_chefe DESC, em.ordem, op.nome)-1
FROM alvo a
JOIN fsbf_equipa_membros em ON em.fsbf_bsbf_id = a.fsbf_bsbf_id
JOIN operacionais_fsbf op   ON op.id = em.operacional_id;
-- contentor = união das guarnições dos filhos
CREATE TEMP TABLE pais AS
  SELECT p.id FROM meios p
  WHERE p.fsbf_bsbf_id IS NOT NULL AND p.meio_pai_id IS NULL
    AND p.estado <> 'desmobilizado'
    AND (SELECT count(*) FROM meios_operativos o WHERE o.meio_id=p.id)=0;
INSERT INTO meios_operativos (meio_id, nome, ordem)
SELECT p.id, x.nome, row_number() OVER (PARTITION BY p.id ORDER BY f.eq, x.ordem)-1
FROM pais p JOIN meios f ON f.meio_pai_id=p.id
JOIN meios_operativos x ON x.meio_id=f.id;
COMMIT;
```

Resultado: 3 filhos actualizados (8 nomes) e 1 contentor preenchido (8 nomes).

| Meio | Declarado | Nomes antes | Nomes depois |
|---|---|---|---|
| BSBF Sul (contentor) | 12 | 0 | 8 |
| VFCI 04 | 5 | 1 | 5 |
| VAOP 12 | 2 | 1 | 2 |
| VFCI 03 | 5 | 1 | 1 |

### O que continua por resolver

- **A BSBF Sul declara 12 operacionais e só há 8 nomes na escala.** Não é
  defeito do código: a guarnição do VFCI 03 tem 1 membro registado para 5
  declarados. Falta preencher a Carta de Meios.
- **Composições SF (BSF) e Gruata não têm de onde copiar.** `composicao_membros`
  liga a **recursos e viaturas**, não a pessoas; o módulo SF não regista quem
  vai em cada equipa. Enquanto assim for, uma BSF nasce sempre sem nomes. Era
  preciso decidir primeiro onde é que essa guarnição passaria a ser registada.
- **Meios soltos**: 60 dos 63 não têm nome nenhum — são preenchidos à mão na
  ficha, e ninguém os preencheu.

### Como validar

1. Abrir **Editar Meio** na `BSBF Sul`: as caixas de nome devem vir preenchidas.
2. Confirmar os nomes nos crachás do cartão e na Ficha do Meio.
3. Despachar uma BSBF nova com guarnição registada e confirmar que já nasce com
   os nomes, sem correcção de dados nenhuma.
4. Despachar uma EMR e confirmar o mesmo no MR.

---

## 20 — Retomar operação depois do descanso repõe o tempo de operação

**Data:** 19/08/2026 · **Estado:** por validar

### O que muda

Pôr um meio em **Descanso** e voltar a **Em Operação** não mexia no relógio: o
meio regressava com o tempo do turno anterior, muitas vezes já **EXPIRADO**. O
descanso serve precisamente para repor o tempo de operação, pelo que o relógio
tem de recomeçar.

Era deliberado — o código dizia `// Resume operation from rest — no new
timestamps` e gravava só `estado`. O mesmo acontecia ao mudar o estado pelo
**Editar Meio**.

### Porque não bastava carimbar a chegada de novo

`timeInfo()` calculava tudo a partir de `data_chegada`/`hora_chegada`. Reiniciar
o relógio por aí obrigaria a reescrever a **chegada ao TO** — que é um facto
registado, aparece no cartão, na tabela, na Ficha do Meio e nos relatórios.

Separaram-se as duas coisas com um campo novo, `op_inicio_data`/`op_inicio_hora`:

- **Chegada ao TO** — quando o meio chegou. Não se reescreve.
- **Início da janela de operação** — onde o relógio de fadiga arranca. Igual à
  chegada até ao primeiro descanso; recomeça a cada retoma.

A migração preenche o campo novo com a chegada, pelo que nada muda para os meios
que nunca descansaram.

### Comportamento

Meio chegado às 08:00 com 12h máximas, retomado às 17:02:

| | Tempo restante |
|---|---|
| Em operação, antes do descanso | 2h57m (75% · amarelo) |
| Retoma **antes** da correcção | 2h57m (75%) — continuava a contar |
| Retoma **depois** da correcção | 11h59m (0% · verde) |
| Chegada ao TO depois da retoma | 08:00 — intacta |

Um meio que já estivesse **EXPIRADO** antes do descanso volta com a janela
inteira, que é o ponto.

A janela de retoma passa a mostrar a hora de recomeço e a permitir rever as
**horas máx. operação** (por omissão, as anteriores).

### Defeito encontrado pelo caminho

`limite_op_date` era gravado com `toISOString()`, que é **UTC**. Uma retoma
depois da meia-noite ficava com a data do dia anterior. Não dava por isso porque
`timeInfo()` ignorava o campo e reconstruía o limite a partir da chegada; ao
passar a usá-lo, tinha de ficar correcto. Passa a sair dos componentes locais,
como `dataISO()` já fazia.

### Alterações

- `server.js` — colunas `op_inicio_data`/`op_inicio_hora` com preenchimento a
  partir de `data_chegada`; entram em `MEIO_COLS`.
- `Gestao_Meios_v17.html`
  - `reiniciarJanelaOp()` — reinicia a janela e devolve os campos a gravar.
  - `timeInfo()` — conta a partir da janela; usa `limiteOpDate` quando existe.
  - `applyOpToTeam()`, retoma em `doQuickOp()` (incluindo o grupo composto) e o
    percurso de edição em `saveTeam()`.
  - `mapTeam()` / `persistTeam()` — os campos novos.
- **Base de dados:** migração automática ao arrancar; sem SQL manual.

### Salvaguarda para os registos antigos

Ao passar a usar `limite_op_date`, os registos gravados **antes** da correcção
do fuso passariam a ser lidos com a data errada — e um meio com o limite entre
as 00:00 e as 00:59 apareceria como **EXPIRADO** sem o estar. São 2 em 64 no
beta2 e **1 dos 9 meios activos do beta1**.

`timeInfo()` passa por isso a aceitar `limite_op_date` só quando cai **depois**
do início da janela; caso contrário deriva o limite como fazia antes. Os três
casos — data certa, data um dia atrás, e sem data — dão agora o mesmo resultado.

### Como validar

1. Meio em operação perto do limite: anotar o tempo restante.
2. Descanso → **Retomar Op.**: o tempo restante volta ao máximo e a barra fica
   verde.
3. Confirmar que a **Chegada** no cartão continua a original.
4. Repetir pelo **Editar Meio** (descanso → Em Operação): mesmo resultado.
5. Num conjunto composto com «aplicar a todos», confirmar que todos os membros
   repõem o relógio.
6. Retomar depois da meia-noite e confirmar que o limite fica no dia certo.

---

## 21 — Adicionar Meio deixa de oferecer o estado Descanso

**Data:** 19/08/2026 · **Estado:** por validar

### O que muda

O selector de **Estado** do **Adicionar Meio** oferecia os cinco estados. O
descanso não é um estado de partida: é a pausa de quem já esteve em operação, e
nenhum meio é empenhado directamente para descanso.

Passa a oferecer apenas **Previsto · Em Trânsito · Em Operação · Desmobilizado**.

Na **edição** nada muda — é lá que a pausa acontece:

| Situação | Estados oferecidos |
|---|---|
| Adicionar | previsto, transito, operacao, desmobilizado |
| Editar (admin/of. ligação) | os cinco, descanso incluído |
| Editar (operacional, em operação) | operacao, descanso, desmobilizado |
| Editar (operacional, em descanso) | descanso, operacao, desmobilizado |

### Alterações

- `Gestao_Meios_v17.html` — `MEIO_ESTADOS_INICIAIS` e `meioEstadoOptsCompleto()`,
  que só é chamada ao adicionar; a edição passa por `meioEstadoOpts()` e fica
  intacta.
- **Base de dados:** nenhuma alteração.

### Como validar

1. **Adicionar Meio**: confirmar que *Em Descanso* não aparece no Estado.
2. **Editar** um meio em operação: *Em Descanso* continua disponível.
3. Editar um meio já em descanso: continua a poder retomar operação.

---

## 22 — Empenhar um meio directamente num PCF/AIM

**Data:** 19/08/2026 · **Estado:** por validar

### O que muda

O posto de comando de um meio era herdado do sítio onde se estava: o payload
lia `currentPostoId`, que só deixa de ser nulo depois de se **entrar** num
PCF/AIM. Como os meios se acrescentam a partir da ocorrência, caíam todos no
PCO Principal, e atribuí-los exigia uma segunda passagem com o **⇄ PCO**.

Essa segunda passagem quase nunca acontecia:

| Ocorrência | Postos | No PCO Principal | Num posto |
|---|---|---|---|
| Matosinhos, Leça do Balio | Frente 1 · Frente 2 | 14 | **5** |
| Ourém, Fátima | PCF Norte · AIM Ourém | 17 | 0 |
| Vila Real, Ervões | Frente 1 · Frente 2 | 6 | 0 |
| Faro, Loulé, Salir | PC Salir Sul | 18 | 0 |
| ZZTESTE Sertã | AIM · PCF | 7 | 0 |

66 meios no PCO Principal contra 5 em postos, em seis ocorrências que se deram
ao trabalho de criar postos — e uma só ocorrência responde por todas as
atribuições que existem.

Passa a haver um selector **Posto de Comando** na caixa **Operação** do
Adicionar/Editar Meio e no modal de **despacho de meios nacionais**. Só aparece
quando a ocorrência tem postos.

O valor por omissão é `currentPostoId`: entrar num PCF e acrescentar lá um meio
continua a colocá-lo nesse PCF. O selector acrescenta uma escolha sem tirar
nenhuma.

### Âmbito

| Via | Antes | Agora |
|---|---|---|
| Adicionar/Editar Meio | herdava o contexto | escolhe-se |
| Composição BSF | já aceitava posto (pai e filhos) | inalterado |
| BSBF | sempre PCO Principal | escolhe-se; pai e filhos |
| EMR | sempre PCO Principal | escolhe-se; MR e filhos |
| EGFR | sempre PCO Principal | escolhe-se |
| Gruata | sempre PCO Principal | escolhe-se; pai, linhas e MR |

A Gruata entrou por partilhar o mesmo modal de despacho: deixá-la de fora dava
um campo que era ignorado só nesse caso.

Nos conjuntos compostos o posto vai sempre do pai para os filhos, para o
conjunto não nascer repartido por dois postos — que a vista por sector mostraria
em blocos separados.

### Três defeitos evitados pelo caminho

1. **`'' || anterior`.** Ler o campo com `sel.value || anterior` fazia com que
   escolher *PCO Principal* — que vale `''` — caísse no valor anterior. Nunca
   mais se trazia um meio de volta ao principal. Distingue-se agora campo
   ausente de escolha vazia.
2. **Posto desactivado.** Um posto inactivo não vem na lista; sem o acrescentar
   como opção, editar um meio que lá estivesse mudava-o em silêncio para o PCO
   Principal ao gravar.
3. **Validação a devolver 500.** O helper novo lança um erro com `status: 400`,
   mas o `wrap()` respondia sempre 500 aos erros que não fossem do Postgres. Um
   500 é repetido para sempre pela fila de sincronização (só os 4xx é que se
   descartam — ver alteração 10), pelo que um posto inválido voltaria a
   envenenar a fila. `wrap()` passa a respeitar `e.status`.

### Alterações

- `server.js`
  - `postoDaOcorrencia()` — recusa um posto que não seja da ocorrência ou que
    esteja inactivo. A chave estrangeira só garantia que o posto existia.
  - Aplicado a `POST /api/meios`, `PATCH /api/meios/:id` (contra a ocorrência do
    próprio meio, não a que vier no corpo) e aos quatro despachos.
  - `wrap()` — respeita `e.status`.
- `Gestao_Meios_v17.html` — `preencherPostoOpts()`, `nomePosto()`, o campo nos
  dois modais, e o registo da transferência na edição (Fita do Tempo e eventos
  do meio), como já se fazia para o setor.
- **Base de dados:** nenhuma alteração de esquema.

### Como validar

1. Numa ocorrência **sem** postos: o campo não aparece.
2. Numa **com** postos: **Adicionar Meio** mostra *PCO Principal* + os postos.
3. Escolher um PCF e confirmar que o meio aparece nesse bloco da vista por sector.
4. Entrar num PCF e acrescentar um meio: deve vir já com esse PCF por omissão.
5. Editar esse meio e escolher *PCO Principal*: tem de voltar ao principal, e a
   Fita do Tempo regista a transferência.
6. Despachar uma BSBF para um PCF e confirmar que **as viaturas todas** lá ficam.
7. Repetir com EMR e EGFR.

---

## 23 — «N.º Operacionais» deixa de parecer preenchido com 4

**Data:** 19/08/2026 · **Estado:** por validar

### O que muda

A caixa **N.º Operacionais** do Adicionar Meio parecia trazer um **4** já
escrito. Não trazia: era o `placeholder`, e o valor é limpo ao abrir o modal.
Mas num campo numérico um algarismo cinzento não se distingue de um valor real,
e passava-se à frente a pensar que já estava preenchido.

Passa a dizer **«Indicar n.º»**, que não se confunde com um número. A caixa
alarga de 120 px para 150 px para o texto caber.

### Alterações

- `Gestao_Meios_v17.html` — `placeholder` e largura do `team-ops`.
- **Base de dados:** nenhuma alteração.

### Fica por decidir

O campo **Nº Operacionais do PM** (`team-pm-ops`) tem o mesmo problema, com
`placeholder="0"`. Não foi mexido por estar fora do que foi pedido; é a mesma
linha se quiser.

### Como validar

1. **Adicionar Meio**: a caixa deve mostrar *Indicar n.º* em cinzento.
2. Escrever um número e confirmar que as linhas de nome aparecem como antes.

---

## 24 — Meio desmobilizado deixa de mostrar Setor, Posto de Comando e Missão

**Data:** 19/08/2026 · **Estado:** por validar

### O que muda

Na caixa **Operação** do Editar Meio, um meio **Desmobilizado** continuava a
mostrar **Setor**, **Posto de Comando** e **Missão / Posição**. Um meio
desmobilizado saiu do teatro de operações: não está em setor nenhum, não
responde a nenhum posto e não tem missão atribuída. Os três campos passam a
desaparecer nesse estado.

| Estado | Setor · Posto · Missão |
|---|---|
| Previsto, Em Trânsito, Em Operação, Em Descanso | visíveis |
| **Desmobilizado** | **escondidos** |

O Posto de Comando mantém a regra que já tinha: continua escondido nas
ocorrências sem postos, seja qual for o estado.

### Esconder não é apagar

Os campos saem de vista mas ficam no formulário com os valores que tinham, e é
esses que se gravam. O setor e a missão em que o meio esteve durante a operação
não se perdem ao desmobilizá-lo — ficam no registo, na Ficha do Meio e nos
relatórios. O posto já tinha esta protecção desde a alteração 22: com o campo
escondido, o payload usa o valor guardado em vez de o pôr a nulo.

Verificado: com o meio desmobilizado, `team-setor` mantém `BRAVO`,
`team-missao` mantém o texto e `team-posto` mantém o posto.

### Alterações

- `Gestao_Meios_v17.html` — invólucros `fld-setor` e `fld-missao`, e a regra em
  `toggleMobilizacaoFields()`, que corre depois de `preencherPostoOpts()` nos
  dois percursos (adicionar e editar) e por isso manda na visibilidade final.
- **Base de dados:** nenhuma alteração.

### Como validar

1. Editar um meio em operação: os três campos aparecem.
2. Mudar o Estado para **Desmobilizado**: os três desaparecem de imediato.
3. Gravar, reabrir e confirmar na Ficha do Meio que o setor e a missão
   continuam registados.
4. Numa ocorrência sem postos, confirmar que o Posto de Comando continua
   escondido em qualquer estado.

---

## 25 — Missão passa a ter acção própria no cartão do meio

**Data:** 19/08/2026 · **Estado:** por validar

### O que muda

A **Missão / Posição** só se alterava abrindo o **Editar Meio** — um formulário
inteiro, com bloqueios por fase, para mudar um campo de texto. O setor, o
sector e o posto já tinham acção própria no cartão; a missão não.

Passa a haver um botão **◎ Missão** no cartão, ao lado do **⊞ Setor**. Abre uma
janela pequena com a missão actual, um campo para a nova, e as **missões já em
uso na ocorrência** como sugestões — para o mesmo posto não ficar escrito de
três maneiras diferentes. Deixar em branco retira a missão.

O botão aparece em todos os estados menos **Desmobilizado**, seguindo a regra da
alteração 24: um meio que saiu do TO não tem missão.

Em conjuntos compostos entra na lista do **«aplicar a todos»**, como o setor:
uma BSF inteira pode receber a mesma missão de uma vez.

### Registo na Fita do Tempo

Cada alteração escreve nos dois sítios que alimentam a Fita do Tempo, com o
antes e o depois — tal como `applySectorToTeam` já fazia:

| Destino | Categoria na Fita | Texto |
|---|---|---|
| `meios_eventos` | Meios ICNF | `Missão: PF Barão → OF LIG.` |
| `ocorrencias_eventos` (tag `missao`) | Ocorrência | `SF 01-115 — missão: PF Barão → OF LIG.` |

Retirar a missão fica igualmente registado (`Missão: OF LIG → —.`), e atribuir
a um meio que não tinha aparece como `— → Flanco direito`. Não é preciso
categoria nova: a Fita classifica pela origem da linha e não pela `tag`, que
não tem restrição na base.

Se a missão não mudar, não se grava nem se regista nada.

### Alterações

- `Gestao_Meios_v17.html` — `applyMissaoToTeam()`, `doQuickMissao()`, o ramo
  `missao` do `quickAction()`, o botão no cartão, e `missao` na lista dos tipos
  que oferecem «aplicar a todos».
- **Base de dados:** nenhuma alteração.

### Como validar

1. Num meio em operação, carregar em **◎ Missão**, escrever uma missão e
   confirmar que aparece no cartão.
2. Abrir a **Fita do Tempo** e confirmar as duas linhas, com o antes e o depois.
3. Repetir deixando o campo em branco: a missão sai e fica registado.
4. Num meio de uma BSF, usar **aplicar a todos** e confirmar que o conjunto
   inteiro fica com a mesma missão.
5. Confirmar que um meio **desmobilizado** não mostra o botão.

---

## 26 — Categoria «Missão» na Fita do Tempo, com o meio identificado

**Data:** 20/08/2026 · **Estado:** por validar

### O que muda

A alteração 25 já gravava a `tag` `missao`, mas a Fita do Tempo **não usa a tag
para nada**: classifica pela origem da linha. Tudo o que vem de
`ocorrencias_eventos` era `ocorrencia`, pelo que as mudanças de missão ficavam
misturadas com o resto e não se podiam filtrar.

Passa a haver categoria própria **Missão**, com etiqueta âmbar. O botão de
filtro aparece na Fita assim que existir uma entrada dessas — como acontece com
as outras categorias, que se constroem a partir dos dados presentes.

### O meio deixa de se perder

`ocorrencias_eventos` guarda `meio_label` **desde sempre e em todos os eventos
que envolvem um meio** — 477/477 nos de estado, 70/70 nos de setor, 25/25 nos
de posto. A consulta da Fita descartava-o (`NULL`) e o meio só se via dentro do
texto da mensagem, sem crachá próprio.

Passa a ser devolvido. O efeito não é só na missão: **todas** as entradas de
nível de ocorrência que envolvem um meio passam a mostrar o crachá do meio, o
que muda o aspecto das linhas que já lá estão — para melhor, mas muda.

Verificado com dados reais do beta2:

| Categoria | Título | Meio |
|---|---|---|
| `missao` | VLCI 11 — missão: — → Teste missão Fita Tempo. | **VLCI 11** |
| `meios_icnf` | Missão: — → Teste missão Fita Tempo. | VLCI 11 |

### Nota sobre a duplicação

Cada mudança de missão continua a dar **duas** linhas: a do meio
(`meios_eventos`, categoria Meios ICNF) e a da ocorrência (categoria Missão).
Não é novo — o setor e o estado sempre fizeram o mesmo. A diferença é que agora
o filtro **Missão** dá uma lista limpa, uma linha por alteração.

### Alterações

- `server.js` — na consulta da Fita, o ramo de `ocorrencias_eventos` passa a
  devolver `oe.meio_label` e a mapear `tag='missao'` para a categoria `missao`.
  As restantes tags continuam em `ocorrencia`.
- `Gestao_Meios_v17.html` — `TL_CATS.missao` e a classe `.tl-cat-missao`.
- **Base de dados:** nenhuma alteração; só se passou a ler o que já lá estava.

### Como validar

1. Mudar a missão de um meio pelo **◎ Missão**.
2. Abrir a **Fita do Tempo**: deve aparecer o botão de filtro **Missão**.
3. Filtrar por Missão e confirmar uma linha por alteração, com o crachá do meio.
4. Confirmar que as entradas antigas (setor, estado) passaram a mostrar também
   o crachá do meio.

---

## 27 — Contagens do cabeçalho de setor/PCO: contentores fora, e rótulos por extenso

**Data:** 20/08/2026 · **Estado:** por validar

### O que estava errado

O cabeçalho de cada setor contava **linhas da tabela**, não meios:

```js
const ops = st.filter(t => t.estado === 'operacao').length;
```

O contentor de uma BSF/BSBF não é um meio — é o rótulo do conjunto — mas
entrava na conta na mesma. No setor **BRAVO** da ocorrência de Faro estão o
contentor `BRIG 01-185` e os seus três `SF`, e o cabeçalho dizia **4** enquanto
o cartão logo abaixo dizia **3 meios**. Dois números diferentes para a mesma
coisa, no mesmo ecrã.

O efectivo (**15**) já estava certo: usa `somaOperacionais()`, corrigido na
alteração 11.

### O que passa a ser

| | Antes | Agora |
|---|---|---|
| BRAVO | 🟢 4 op. · 🟡 0 desc. · 👥 15 op.ais | 🟢 **3** Veículos · 🟡 0 Descanso · 👥 15 Operacionais |

Os rótulos passam a **Veículos**, **Descanso** e **Operacionais**, por extenso —
`op.` e `op.ais` liam-se mal e confundiam-se um com o outro.

**Nota sobre o primeiro número:** era «em operação» e passa a ser o total de
veículos do setor. Como os grupos de setor só contêm meios em operação ou em
descanso, o total é a soma dos dois, e o **Descanso** passa a ler-se como
subconjunto: *3 veículos, dos quais 0 em descanso*. Se preferir que o primeiro
número continue a ser só os que estão em operação, é uma linha.

### O mesmo defeito noutros dois sítios

Verificados a propósito, e corrigidos:

- Cabeçalhos dos blocos **Previstos** e **Em Trânsito** — contavam contentores.
- **RESUMO do relatório exportado** — o total já usava `somaMeios()`, mas as
  parcelas por estado (`em op.`, `descanso`, `desmob.`) contavam contentores, o
  que fazia com que as parcelas não fechassem com o total.

### Casos verificados

| Caso | Veículos | Descanso | Operacionais |
|---|---|---|---|
| BRAVO: contentor BSF + 3 SF | 3 | 0 | 15 |
| ALFA: `EGFR 03` em descanso | 1 | 1 | 3 |

O `EGFR 03` tem `composicao_id` mas não tem filhos, pelo que **não** é
contentor e conta como veículo — a distinção que `meioEhContentor()` já fazia.

### Alterações

- `Gestao_Meios_v17.html` — `renderSectorGroups()` passa a usar `somaMeios()` e
  a excluir contentores do descanso; cabeçalhos de Previstos/Em Trânsito; e o
  RESUMO do relatório.
- **Base de dados:** nenhuma alteração.

### Como validar

1. Na ocorrência de Faro, setor BRAVO: o cabeçalho deve dizer **3 Veículos** e
   coincidir com os **3 meios** do cartão.
2. Confirmar **15 Operacionais**.
3. Pôr um meio em descanso e confirmar que o Descanso sobe e os Veículos não.
4. Exportar o relatório e confirmar que as parcelas do RESUMO fecham com o total.

---

## 28 — Todos os contadores de meios da aplicação

**Data:** 20/08/2026 · **Estado:** por validar

### Porquê

A alteração 27 corrigiu os cabeçalhos de setor, mas o defeito era geral: **em
toda a aplicação os contadores contavam linhas da tabela**, e o contentor de
uma BSF/BSBF entrava sempre. Foi feito o varrimento completo.

Impacto real no beta2, nas ocorrências activas:

| Ocorrência | Antes | Depois | A mais |
|---|---|---|---|
| 20261150361 · Matosinhos | 18 | **15** | 3 |
| 20261163776 · Faro | 13 | **11** | 2 |

Na de Faro, por estado: *Em Trânsito* 8 → **7**, *Em Operação* 5 → **4**.

### Onde foi corrigido

**Página principal**
- Contadores globais: meios activos, em operação, em descanso, desmobilizados.
- Cartão da ocorrência: *Meios PCO*, *Meios Total*, o número grande do cartão,
  e as contagens de operação/descanso.
- Cartão de cada PCF/AIM: número de meios e operação/descanso.
- Blocos por módulo — **SF** (ESF e BSF), **FSBF** (FSBF e EMR) e **EGFR**:
  o número de *Meios* e as linhas de estatísticas de cada um.

**Página da ocorrência**
- Painel de estados: operação, descanso, desmobilizados, trânsito, previstos.
- Secção de postos: meios por PCF/AIM.

**Arquivo**
- Meios por ocorrência arquivada e o total do arquivo.

**Relatório exportado**
- Meios por posto de comando.

**Servidor**
- `GET /api/ocorrencias/:id/postos` devolvia `meios_count` com o contentor
  incluído. O frontend não o lê — calcula do seu lado — mas era um número errado
  a sair da API, à espera de que alguém o usasse.

### Como ficou

Duas funções passam a ser o único sítio onde se contam meios:

```js
somaMeios(teams)          // total, sem contentores
contaEstado(teams, estado) // por estado, sem contentores
```

No servidor, a mesma regra em SQL: sem pai, com filhos, e com marca de
composição (`composicao_id` ou `fsbf_bsbf_id`).

Verificado que as duas dão o mesmo: corridas as funções do ficheiro contra as
48 linhas reais das ocorrências activas do beta2, os totais batem certo com a
consulta SQL — 18→15 e 13→11.

### Como validar

1. Página principal: o número de meios de cada ocorrência com BSF/BSBF deve
   baixar, e passar a coincidir com o que a página da ocorrência mostra.
2. Nos blocos **Gestão FSBF** e **Gestão SF**, confirmar que *Meios* já não
   conta os contentores.
3. Abrir a ocorrência e confirmar que o painel de estados soma ao total.
4. Arquivo: confirmar que o total de meios acompanha.

---

## 29 — Carta de Meios: a linha da EMR deixa de sair fora do cartão

**Data:** 20/08/2026 · **Estado:** por validar

### O que muda

Na **Gestão FSBF → Carta de Meios**, o campo **Chefe** das linhas de EMR
transbordava para fora do cartão e punha a página com barra horizontal.

A causa é do HTML e não do CSS da aplicação: um `<select>` **sem largura
definida dimensiona-se pelo `option` mais comprido**. A lista do Chefe são os
operacionais FSBF, com nomes completos em maiúsculas, e o campo esticava-se até
ao comprimento do maior. Como as células de uma grelha têm `min-width:auto`, a
coluna não podia encolher e empurrava o cartão todo.

É por isso que só acontece na EMR: a linha da **BSBF** já tinha
`width:160px` no seu Chefe, e a da EMR nunca teve largura nenhuma.

Passam a caber na coluna todos os controlos da linha EMR — Base, MR, VAOP,
Vpiloto, VLCI, Chefe, Contacto e Ocorrência.

### Alterações

- `Gestao_Meios_v17.html`
  - Classe `fsbf-emr-grid` na grelha da linha EMR.
  - CSS: `min-width:0` nas células, para a coluna poder encolher, e
    `width:100%` nos `select`/`input`, para caberem nela.
  - O campo **Total Op.** mantém os seus 38 px: a largura está no `style` da
    própria etiqueta e um `style` inline manda sempre sobre uma regra de folha
    de estilos.

### Efeito a confirmar

Com o campo à largura da coluna, um nome comprido passa a aparecer cortado
quando o `select` está fechado — vê-se inteiro ao abrir a lista. É o mesmo
comportamento que a linha da BSBF já tinha com os seus 160 px.

### Como validar

1. **Gestão FSBF → Carta de Meios**, secção EMR.
2. Confirmar que o Chefe já não passa a moldura do cartão e que a página deixou
   de ter barra de deslocamento horizontal.
3. Abrir a lista do Chefe e confirmar que os nomes se lêem por inteiro.
4. Confirmar que o **Total Op.** continua estreito, com o botão da guarnição ao
   lado.

---

## 30 — Vista de Tabela: conjuntos compostos numa só linha

**Data:** 20/08/2026 · **Estado:** por validar

### O que muda

A alteração 18 recolheu os conjuntos nos cartões e deixou de fora a **Tabela**,
onde cada membro continuava a ocupar uma linha, apenas indentada com `└`. Numa
BSF com três `SF`, eram quatro linhas para três meios.

A Tabela passa a recolher da mesma maneira: o conjunto é **uma linha**, com o
botão `⬡ N meios` a abrir e fechar. Fechado por omissão.

O estado aberto/fechado é **o mesmo dos cartões** (`_conjuntosAbertos`): um
conjunto aberto na Tabela continua aberto ao voltar aos Cartões, e ao contrário.

### O que a linha recolhida mostra

Com os filhos recolhidos, as colunas passam a valer pelo conjunto:

| Coluna | Recolhido |
|---|---|
| Meio | nome + `⬡ 3 meios` |
| Setor | o setor comum, ou *«2 setores»* se divergirem |
| Operacionais | o efectivo do conjunto (15, não os 5 de um membro) |
| Tempo | o membro **mais perto do limite**, nomeado — `2h14m · SF 07-185` |
| Estado | o estado comum, ou *«1 descanso · 2 em op.»* se divergirem |

O relógio é o do membro mais urgente e não o do contentor, que nem sequer
opera. Sem isto, recolher escondia quem estava a chegar ao limite.

### Verificação

Funções extraídas do ficheiro e corridas em Node, com um conjunto BSF
(contentor + 3 SF) mais um meio solto:

| Cenário | Linhas |
|---|---|
| Recolhido (por omissão) | **2** (era 5) |
| Expandido | 5, com os filhos indentados como antes |
| Estados/setores diferentes | mostra `1 descanso · 2 em op.` e `2 setores` |

Colunas da linha recolhida: `⬡ 3 meios`, efectivo **15**, e o tempo do membro
mais perto do limite com o nome ao lado.

### Alterações

- `Gestao_Meios_v17.html`
  - `renderTableView()` — esconde os filhos de conjuntos recolhidos e resume as
    colunas na linha do pai.
  - `resumoConjunto()` — passa a devolver também `setores` e `divergente`.
  - A seta do botão roda por `aria-expanded`, para funcionar na Tabela, que não
    tem o invólucro `.conjunto` dos cartões.
- **Base de dados:** nenhuma alteração.

### Como validar

1. Ocorrência com uma BSF, vista **Tabela**: deve ver uma linha, não quatro.
2. Carregar em `⬡ 3 meios`: aparecem os três, indentados.
3. Voltar aos **Cartões**: o conjunto deve estar aberto também lá.
4. Pôr um membro em descanso e confirmar que a linha recolhida passa a dizer
   `1 descanso · 2 em op.`.
5. Confirmar que o efectivo da linha é o do conjunto.

---

## 31 — Meios já despachados continuavam a aparecer livres na lista do ofligacao_ccon

**Data:** 20/08/2026 · **Estado:** por validar

### O defeito

Na ocorrência **20261163776 (Faro)** o **M01** está despachado, em trânsito, e
mesmo assim continuava a aparecer com botão **🚀 Despachar** na lista de meios
nacionais.

A causa é a **Carta de Meios ter uma linha por dia**. O M01 tem uma linha de
escala para cada data — 13/08, 14/08, …, 20/08 — e o despacho ficou preso à
linha de **16/08**. A lista, filtrada pelo dia escolhido, mostrava a linha de
**hoje**, que é outra linha, sem despacho associado:

```sql
LEFT JOIN meios m ON m.fsbf_emr_id = e.id AND m.estado <> 'desmobilizado'
```

Ou seja: a exclusividade estava a ser avaliada **por linha de escala** e não
pelo meio físico.

| Linha de escala do M01 | Marcada despachada |
|---|---|
| 2026-08-20 (a que se vê hoje) | **não** |
| 2026-08-16 (a que foi despachada) | sim |

O mesmo na **BSBF**, cuja consulta comparava `e2.data = e.data`: as três
viaturas da Brigada Sul estavam em uso em Faro e as linhas de hoje davam-nas
por livres.

### Porque não dava asneira maior

O despacho em si **recusava**: a verificação por viatura (`m.viatura_id = ANY`)
apanhava o conflito e devolvia *«Viatura já está em uso na ocorrência…»*. Ou
seja, o sistema estava seguro — mas a lista convidava a uma acção que ia falhar,
e dava a entender que o meio estava disponível quando não estava.

### A correcção

O «já despachado» passa a olhar para a **viatura**, que é o que persiste de um
dia para o outro, alinhando a lista com o que o despacho já exigia. Na EMR basta
qualquer uma das quatro viaturas (MR, VAOP, Vpiloto, VLCI) estar em uso.

Verificado contra o beta2, na lista de **2026-08-20**:

| Equipa | Antes | Agora |
|---|---|---|
| EMR M01 | livre | **Faro, Loulé, Salir** |
| EMR M03, M04, M09, M15, M16, M23 | livres | livres |
| BSBF Sul — VAOP 12, VFCI 03, VFCI 04 | livres | **Faro, Loulé, Salir** |
| BSBF Norte e Outros | livres | livres |

### Alterações

- `server.js` — `GET /api/fsbf/disponivel`: as consultas da BSBF e da EMR
  passam por um `LEFT JOIN LATERAL` que considera despachada a linha cuja
  viatura esteja num meio activo, além da regra antiga da linha do próprio dia.
- **Base de dados:** nenhuma alteração.

### Fica por resolver

A **Gruata** tem o mesmo defeito — a consulta também compara só o dia — mas não
se corrige da mesma maneira: os meios criados pelo despacho de Gruata **não
guardam `viatura_id`**, pelo que não há viatura por onde os apanhar. Corrigi-lo
exige primeiro que esse despacho passe a registar as viaturas.

### Como validar

1. Como `ofligacao_ccon`, abrir a lista de meios nacionais no dia de hoje.
2. O **M01** deve aparecer como **✓ Em uso**, com a ocorrência de Faro.
3. As três viaturas da **BSBF Sul** idem.
4. Desmobilizar o M01 e confirmar que volta a aparecer despachável.

---

## 32 — O mesmo defeito no EGFR, com uma consequência pior

**Data:** 20/08/2026 · **Estado:** por validar

### Sim, existia — e era mais grave

O EGFR tinha o mesmo defeito da alteração 31: a lista marcava «já despachado»
olhando só para o dia.

```sql
WHERE m.egfr_data = $1 AND m.egfr_equipa IS NOT NULL AND m.estado <> 'desmobilizado'
```

O **EGFR 03** está em operação em Faro desde a escala de **16/08**. Na lista de
**20/08** apareciam **zero** equipas despachadas — logo, dava-se por livre.

**A diferença para a FSBF é que aqui não havia rede de segurança.** No caso da
BSBF/EMR o despacho recusava na mesma, porque verificava a viatura. O despacho
EGFR só tinha a verificação por `egfr_data` + `egfr_equipa`, e **nenhuma
verificação de viatura**. Ou seja: não era só a lista a enganar-se — o despacho
teria sido **aceite**, pondo a mesma equipa EGFR em duas ocorrências ao mesmo
tempo.

O `EGFR 03` de Faro está, ainda por cima, **sem viatura atribuída**, pelo que a
correcção da alteração 31 (procurar pela viatura) não o apanharia. No EGFR a
identidade que persiste de um dia para o outro é o **nome da equipa**.

### A correcção

- A lista deixa de filtrar por dia: uma equipa activa é uma equipa activa,
  tenha sido despachada a partir da escala de que dia for.
- O despacho passa a recusar pela **equipa** e não pela linha de escala do dia.
- Acrescentou-se ao despacho EGFR a **verificação de viatura** que faltava, nos
  mesmos termos das restantes — duas equipas podem partilhar viatura em dias
  diferentes da escala.

Verificado contra o beta2: a consulta corrigida devolve `EGFR 03 · operacao ·
Faro, Loulé, Salir`, que a lista de hoje passa a mostrar como **✓ Em uso**.

### Alterações

- `server.js`
  - `GET /api/egfr/escala` — a consulta do estado de despacho perde o filtro por
    `egfr_data`.
  - `POST /deploy/egfr` — exclusividade por `egfr_equipa`; nova verificação de
    conflito de viatura.
- **Base de dados:** nenhuma alteração.

### Como validar

1. Como `ofligacao_ccon`, abrir a escala EGFR de hoje.
2. O **EGFR 03** deve aparecer **✓ Em uso**, com a ocorrência de Faro.
3. Tentar despachá-lo de outro dia da escala: deve recusar com «Já despachado
   para "Faro, Loulé, Salir"».
4. Desmobilizar e confirmar que volta a ficar despachável.

---

## 33 — Tempo total de operação no cartão e na tabela

**Data:** 20/08/2026 · **Estado:** por validar

### O que muda

O cartão e a tabela mostravam só o **tempo restante** — quanto falta até ao
limite de operação. Passam a mostrar também o **tempo total**: quanto tempo o
meio leva no teatro de operações, contado da **Chegada ao TO** até agora.

No cartão fica logo a seguir ao tempo restante, com a mesma apresentação, mas
**sem barra**: o tempo total não tem máximo contra o qual se medir. Na tabela é
uma coluna nova, **Tempo Total**, a seguir a *Tempo Rest.*

### Porque são dois números diferentes

Desde a alteração 20 estas duas coisas deixaram de ser a mesma:

| | Origem | No descanso |
|---|---|---|
| **Tempo restante** | início da janela de operação | **repõe-se** ao retomar |
| **Tempo total** | chegada ao TO | **não se repõe** |

Um meio que chegou às 08:00, descansou e retomou às 17:00 mostra *12h* de
restante e *9h* de total — cada um responde à sua pergunta: quanto falta a esta
guarnição, e há quanto tempo o meio está no terreno.

É por isso que a alteração 20 não podia reescrever a chegada: sem ela, este
número não existiria.

### Meios desmobilizados

Para um meio já desmobilizado a contagem **pára na saída do TO**, senão
continuava a crescer para sempre. Nesse caso a etiqueta diz *«Tempo total op.
(até à saída)»*.

### Verificação

| Caso | Tempo total |
|---|---|
| Chegou há 11h14m, em operação | 11h14m |
| Chegou há 3h, em descanso | 3h00m |
| Chegou há 30h | 30h00m |
| Ainda em trânsito, sem chegada | — |
| Chegou há 20h e saiu há 5h | **15h00m** (e não 20h) |

A tabela ficou com 15 colunas no cabeçalho e 15 células por linha.

### Alterações

- `Gestao_Meios_v17.html` — `tempoOperacao()`; bloco no cartão; coluna na
  tabela, com o cabeçalho e o `colspan` do estado vazio actualizados.
- **Base de dados:** nenhuma alteração.

### Como validar

1. Num meio em operação, confirmar as duas linhas no cartão: *Tempo restante
   op.* e *Tempo total op.*
2. Pôr em descanso e retomar: o restante volta ao máximo, o total **não**.
3. Na vista de **Tabela**, confirmar a coluna *Tempo Total*.
4. Num meio desmobilizado, confirmar que o total parou na hora de saída.

---

## 34 — Sem crachás de nomes nos cartões de BSBF e EMR

**Data:** 20/08/2026 · **Estado:** por validar

### O que muda

Depois da alteração 19, as BSBF e as EMR passaram a trazer a guarnição da Carta
de Meios, e os cartões encheram-se de crachás com os nomes — no contentor da
BSBF, a **união** das guarnições de todas as viaturas, e a seguir os mesmos
nomes outra vez em cada viatura.

Nesses dois casos os crachás deixam de aparecer. Fica o **número** de
operacionais, como já acontecia antes de haver nomes.

| Origem | Crachás de nome |
|---|---|
| BSBF — contentor e viaturas | **não**, só o número |
| EMR — MR e membros | **não**, só o número |
| BSF, EGFR e meios soltos | sim, como até aqui |

Os filhos de uma EMR não guardam `fsbf_emr_id` — a ligação está no pai — pelo
que não bastava olhar para o próprio meio; a regra segue também pelo pai.

### Os nomes não se perdem

Continuam gravados e continuam a ver-se na **Ficha do Meio**, que os lista um a
um. O que muda é só o cartão, que é a vista de relance.

### Alterações

- `Gestao_Meios_v17.html` — `meioDeGuarnicaoFsbf()` e a condição dos crachás em
  `teamCardHtml()`.
- **Base de dados:** nenhuma alteração — nada é apagado.

### Como validar

1. Cartão da **BSBF Sul** e das suas viaturas: sem crachás, com «👥 N
   operacionais».
2. Cartão do **M01** e dos membros da EMR: idem.
3. Cartão de uma **BSF** ou de um **EGFR**: os nomes continuam a aparecer.
4. Abrir a **Ficha do Meio** de uma viatura da BSBF: os nomes estão lá.

---

## 35 — Gestão ICNF em consulta para o oficial de ligação

**Data:** 20/08/2026 · **Estado:** por validar

### O que muda

O **oficial de ligação** passa a ter **GESTÃO ICNF** no menu, em modo de
consulta: vê **Recursos** e **Viaturas** e mais nada.

| | Gestor ICNF / admin | Oficial de ligação |
|---|---|---|
| Separadores | Recursos, Viaturas, Rádios, OLN, EGFR | **Recursos e Viaturas** |
| ✎ Editar · ⚡ INOP · ✕ Remover | sim | **não** (a coluna mostra «—») |
| + Novo / + Nova | sim | **não** |
| Importar CSV (ETL) | sim | não |

Aplica-se também ao `ofligacao_ccon`, que é o mesmo perfil com mais alcance —
seria estranho o regional ver o catálogo e o nacional não.

### Não é só esconder botões

Os dois `GET` do catálogo estavam fechados aos oficiais de ligação
(`ALL_GESTORES`), pelo que a página abriria vazia com **403**. Passa a haver um
`CATALOGO_LEITURA` que os admite — **e só nos GET**.

As **oito** rotas de escrita continuam em `ALL_GESTORES`, incluindo as de
prontidão, que é o que põe um meio INOP:

```
GET    /api/gestao/recursos              CATALOGO_LEITURA
GET    /api/gestao/viaturas              CATALOGO_LEITURA
POST   /api/gestao/recursos              ALL_GESTORES
PATCH  /api/gestao/recursos/:id          ALL_GESTORES
DELETE /api/gestao/recursos/:id          ALL_GESTORES
POST   /api/gestao/recursos/:id/prontidao ALL_GESTORES
POST   /api/gestao/viaturas              ALL_GESTORES
PATCH  /api/gestao/viaturas/:id          ALL_GESTORES
DELETE /api/gestao/viaturas/:id          ALL_GESTORES
POST   /api/gestao/viaturas/:id/prontidao ALL_GESTORES
```

Esconder o botão é conforto; o servidor é que decide. Se alguém chamar a rota à
mão, continua a levar 403.

### Duas coisas que faltavam para a página abrir sequer

1. **`navTo()` recusava a página**: `MODULE_PAGES` mandava `gestao-icnf` só para
   `gestor_icnf`, e o clique dava *«Acesso restrito ao gestor deste módulo»*.
2. **O separador podia ficar num que não se pode ler.** Se numa visita anterior
   tivesse ficado em Rádios, `renderGestaoICNF()` iria buscar dados proibidos.
   Em consulta, força-se de volta a Recursos.

### Alterações

- `server.js` — `CATALOGO_LEITURA` nos dois GET do catálogo.
- `Gestao_Meios_v17.html` — `podeGerirICNF()`; entrada de menu; classe
  `icnf-so-gestor` nos separadores restritos e nos botões de criar; acções das
  linhas de Recursos e de Viaturas; `MODULE_PAGES`; salvaguarda do separador.
- **Base de dados:** nenhuma alteração.

### Como validar

1. Entrar como **oficial de ligação**: **GESTÃO ICNF** aparece no menu.
2. Abrir: só **Recursos** e **Viaturas**, sem ✎, ⚡, ✕ nem + Novo.
3. Confirmar que os dados aparecem (não pode ficar vazio nem dar erro).
4. Entrar como **gestor ICNF**: continua a ver os cinco separadores e todas as
   acções.

---

## 36 — Disponíveis nas estatísticas de empenhamento FSBF

**Data:** 20/08/2026 · **Estado:** por validar

### O que muda

As estatísticas tinham dois números: **efetivo** (tudo o que há nos quadros) e
**empenhado** (o que saiu para ocorrência). Passa a haver um terceiro pelo meio,
o **disponível**: o que está constituído na **Carta de Meios do dia**, esteja ou
não empenhado.

```
efetivo  >=  disponível  >=  empenhado
 (tudo)     (de serviço)     (na ocorrência)
```

Exemplo real do beta2, em 20/08:

| Companhia | Op. disp. | Op. emp. | Efetivo | Viat. disp. | Viat. emp. | Dispositivo |
|---|---|---|---|---|---|---|
| Norte | 5 | 0 | 74 | 7 | 0 | 25 |
| Centro | 6 | 0 | 42 | 6 | 0 | 30 |
| Sul | 21 | 0 | 59 | 11 | 0 | 28 |

### Percentagens

Passam a ser duas, e a segunda responde melhor à pergunta:

- **Disponíveis / efetivo** — que fatia do dispositivo está de serviço.
- **Empenhados / disponíveis** — que fatia de quem está de serviço é que saiu.

A percentagem antiga era *empenhados / efetivo*, que dilui o número por gente
que nem sequer está escalada nesse dia.

### Vale a pena notar

O **disponível é o número mais fiável dos três**. Sai directamente da Carta de
Meios — de quem lá está escalado — enquanto o empenhado depende do
`ocorrencia_num` escrito à mão, que quase nunca é preenchido (ver o que ficou
dito na análise das ocorrências da Carta de Meios). É por isso que na tabela
acima os empenhados estão todos a zero e os disponíveis não.

### Alterações

- `server.js`
  - `EMPENHAMENTO_SQL` — CTE `op_disp` e `vi_disp`, iguais aos de empenhamento
    mas sem a condição do `ocorrencia_num`.
  - `fsbf_empenhamento_diario` ganha `op_disponiveis` e `vi_disponiveis`, na
    criação da tabela **e** por `ALTER` a seguir — o `ALTER IF EXISTS` sozinho,
    posto antes do `CREATE`, não fazia nada e uma base nova nascia sem elas.
  - A série devolve as novas contagens e quatro percentagens.
- `Gestao_Meios_v17.html` — dois mosaicos novos e a tabela por companhia com as
  colunas de disponíveis; as percentagens dos totais calculam-se das contagens
  somadas, porque somar percentagens de três companhias não quer dizer nada.
- **Base de dados:** duas colunas novas, por migração automática, **e uma
  correcção de dados** (abaixo) que não viaja com o ramo.

### Correcção de dados aplicada ao beta2

Os 102 instantâneos já gravados ficariam a zeros nas colunas novas — a série
histórica não mostraria disponíveis nenhuns até alguém recalcular dia a dia.
Foram preenchidos a partir da Carta de cada dia:

```sql
UPDATE fsbf_empenhamento_diario e SET
  op_disponiveis = COALESCE((SELECT count(DISTINCT mm.operacional_id)::int
      FROM fsbf_equipa_membros mm JOIN operacionais_fsbf o ON o.id = mm.operacional_id
     WHERE mm.data = e.data AND o.companhia = e.companhia), 0),
  vi_disponiveis = COALESCE((SELECT count(DISTINCT v.id)::int
      FROM ( SELECT veiculo_id AS vid FROM fsbf_bsbf_equipa WHERE data = e.data
             UNION ALL SELECT mr_viatura_id      FROM fsbf_emr_equipa WHERE data = e.data
             UNION ALL SELECT vaop_viatura_id    FROM fsbf_emr_equipa WHERE data = e.data
             UNION ALL SELECT vpiloto_viatura_id FROM fsbf_emr_equipa WHERE data = e.data
             UNION ALL SELECT vlci_viatura_id    FROM fsbf_emr_equipa WHERE data = e.data ) x
      JOIN viaturas v ON v.id = x.vid
      JOIN (SELECT DISTINCT base, companhia FROM operacionais_fsbf
             WHERE ativo AND base IS NOT NULL AND companhia IS NOT NULL) m ON m.base = v.base
     WHERE x.vid IS NOT NULL AND v.dispositivo AND v.ativo AND m.companhia = e.companhia), 0),
  atualizado_em = now();
```

**102 linhas** actualizadas, de 06/07 a 20/08. Verificado depois: **0** linhas
violam `efetivo >= disponível >= empenhado`, e 86 têm disponíveis acima de zero
(as outras 16 são dias sem carta).

### Como validar

1. **Gestão FSBF → Empenhamento**: quatro mosaicos, com disponíveis e
   empenhados para operacionais e viaturas.
2. Confirmar na tabela por companhia as duas percentagens.
3. Abrir a **série diária** e confirmar que os dias anteriores já trazem
   disponíveis.
