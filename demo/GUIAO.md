# Guião da demonstração — Empreitadas FSBF (beta3)

Cerca de 10 minutos. Tudo o que aparece é **sintético** (pedidos, registos
da frota e das máquinas, rendimentos e custos); os meios e os operacionais
são os do catálogo da GOGFR.

## Antes de começar

1. Entrar como administrador e abrir **Empreitadas**.
2. **Repor demonstração** (canto superior direito). Demora uns segundos.
   Volta a gerar tudo com a data de hoje e cria quatro empreitadas:

   | Empreitada | Estado | Para mostrar |
   |---|---|---|
   | EMP-…-001 | Concluída | execução completa, máquinas acima do previsto, um registo duplicado |
   | EMP-…-002 | Em execução | atraso, um registo por fechar, horas por registar |
   | EMP-…-003 | Planeada | meios afectos, ainda sem execução |
   | EMP-…-004 | Seleccionada | uma faixa ao longo de uma estrada, ponto de partida para a recomendação |

Repor de novo no próprio dia da apresentação: a empreitada em execução só
tem registos até à véspera do dia em que se repôs.

## 1. Pedidos (1,5 min)

- O mapa mostra os pedidos em vigor, a tracejado, com cores por tipo de
  rede: primária (RPFGC), secundária (RSFGC) e mosaico (MGC). Filtrar por
  uma base ou por rede.
- Abrir um polígono e uma linha. As linhas são **faixas**: têm largura, e
  o que conta é a área (comprimento × largura).
- Os campos são os da aplicação de pedidos (ESRI): código, DRCNF, NUTS III,
  município, mata nacional ou perímetro, período pedido.
- Mensagem: hoje é uma simulação do serviço de features do ArcGIS; no
  futuro lê-se do serviço, com os mesmos campos.

## 2. Escolher ou criar (1 min)

- **Seleccionar como empreitada** num pedido. O pedido não diz que
  intervenção fazer: a operação vem sugerida pelo tipo de rede (MAO nos
  mosaicos e na rede primária, CAO nas faixas das estradas), e confirma-se
  com o povoamento e o **responsável** (um operacional FSBF).
- **+ Nova empreitada**: desenhar um polígono, uma faixa (linha com
  largura) ou uma linha de rede viária (duplo clique para fechar). Para o
  que não veio nos pedidos.

## 3. Recomendar meios (2,5 min)

- Abrir a empreitada **seleccionada** e carregar em **Recomendar meios**.
- Três alternativas: mais barata, equilibrada, mais rápida. Abrir uma
  operação para mostrar a conta, linha a linha, e os meios concretos (máquina,
  operador, base, distância).
- Mexer no controlo **custo ↔ prazo**: a equilibrada muda.
- **Aceitar** a equilibrada: os meios ficam afectos, aparecem as linhas
  das bases até à obra, e a empreitada passa a planeada.
- Só entram meios livres e operacionais: um meio já afecto noutra
  empreitada no mesmo período aparece desactivado em **+ Afectar meio**.
- Quem preferir escolher os meios à mão também pode: com o primeiro meio
  afecto, a empreitada passa a planeada; sem nenhum, volta a seleccionada.

## 4. Execução em curso (2,5 min)

- Abrir a empreitada **em execução**. A secção Execução compara o real
  até ontem com o previsto até ontem (o traço na barra).
- **Ver execução**: custo, horas de máquina e de operacionais; a anomalia
  (um registo de máquina sem hora de fim, que fica fora das contas).
  Clicar no trator para ver os registos do conta-horas, dia a dia.
- Explicar a regra: os registos da frota e das máquinas não dizem a que
  empreitada servem; conta o que cai nos dias em que o meio está afecto.
- **Folha de horas**: abre no dia por registar (os dias com as horas
  todas a verde, os incompletos a laranja). Desmarcar uma falta, **Guardar**,
  e os números da execução mudam.

## 5. Execução concluída (1 min)

- Abrir a empreitada **concluída**: as máquinas trabalharam cerca de 15 %
  acima das horas previstas e o custo ficou acima do previsto.
- A viagem registada duas vezes é detectada e fica fora das contas.

## 6. Fecho (30 s)

O que é simulado e o que falta para ser real:

- pedidos: ligação ao serviço de features da aplicação de pedidos (ESRI);
- registos: exportações da aplicação da frota (já há exemplo) e das máquinas
  (estrutura por confirmar);
- rendimentos por operação, máquina e povoamento, e custos horários: não
  há tabela; os da demonstração são estimativas, numa tabela que se pode
  afinar (`demo/catalogo/rendimentos.csv`);
- intervenções: a listagem da FSBF, sem o grupo Incêndios Rurais.
