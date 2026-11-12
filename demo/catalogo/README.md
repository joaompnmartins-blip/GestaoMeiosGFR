# Catálogo da demonstração de empreitadas

Estes três ficheiros são a fonte do catálogo. A aplicação lê-os a cada
arranque: para mudar um valor, edita-se o CSV (no Excel abre directamente),
grava-se em CSV separado por `;`, faz-se commit e o `beta3` volta a arrancar
com os valores novos.

## intervencoes.csv

As quatro primeiras colunas são as da `listagem_intervencoes.xlsx`, tal como
vieram (ID, INTERVENCAO, COD, GrupoIntervencao). As três seguintes são da
demonstração:

| Coluna | Valores | Para quê |
|---|---|---|
| GEOMETRIA | `poligono` ou `linha` | linha só na rede viária |
| UNIDADE | `ha` (polígono) ou `km` (linha) | a medida da quantidade |
| MODO | `moto-manual`, `mecanico`, `rede-viaria`, `fogo`, `quimico`, `manual` | a cor no mapa e o filtro |

O grupo **Incêndios Rurais** fica de fora (não é obra); as linhas estão no
ficheiro, mas sem estas três colunas.

Se um código sair da lista ou mudar de sentido, a demonstração repõe-se
sozinha no arranque seguinte (as propostas e empreitadas antigas usavam-no).

## rendimentos.csv

Quanto um meio faz numa hora, em **matos/incultos**, na unidade da operação
(ha/h ou km/h). Uma linha por intervenção; célula vazia quer dizer que esse
meio não faz essa operação. A coluna INTERVENCAO é só para ler.

| Coluna | Meio | Nota |
|---|---|---|
| OP | operacional | **por pessoa**: uma equipa de 6 rende 6 vezes isto |
| TB | trator de rodas com destroçador | |
| TR | trator de rastos | vai em porta-máquinas |
| DR | destroçador frontal de rastos | vai em porta-máquinas |
| MR | máquina de rastos | vai em porta-máquinas |
| GR | máquina giratória de rastos | vai em porta-máquinas |

Uma intervenção sem nenhum rendimento não recebe recomendação de meios.
Os valores são estimativas para a demonstração.

Para ter uma ideia: 0,025 ha/h por operacional são 0,15 ha/h para uma
equipa de 6, cerca de 1 ha por dia de 7 horas.

## povoamentos.csv

Nos povoamentos rende-se menos do que em matos: o rendimento multiplica-se
pelo FACTOR do tipo de povoamento (TIPO_POV). Na rede viária não se aplica.
