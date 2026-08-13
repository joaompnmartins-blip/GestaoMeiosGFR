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
| 1 | 13/08/2026 | Oficiais de ligação vêem os pedidos de remoção | `9af294c` + `51c905a` | por validar |
| 2 | 13/08/2026 | Editar Meio segue o percurso de estados | `42a447b` | por validar |
| 3 | 13/08/2026 | Remoção de meio agregado mostra e protege os filhos | `a916cd8` | por validar |
| 4 | 13/08/2026 | Datas da API normalizadas; fim do NaNhNaNm | `pendente` | por validar |

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
