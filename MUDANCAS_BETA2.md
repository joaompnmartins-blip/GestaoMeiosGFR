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
