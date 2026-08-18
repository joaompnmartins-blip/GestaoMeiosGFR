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
| 16 | 18/08/2026 | Modais de Meio: ordem das caixas, limites de operação condicionais, botão de operacionais | `PENDENTE` | **por validar (só beta2)** |

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
