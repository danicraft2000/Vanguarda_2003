// Composição final da marca — proporções medidas na vinheta histórica.
//
// Unidade de medida: "u" = pixel de um recorte 1250x1080 do quadro final de
// referência (recorte x: 200..2700 do quadro original 2880x2160, escala 0,5).
// y cresce para baixo, como na imagem. Cada glifo é posicionado pelo centro
// horizontal da sua caixa e pela linha de base; a altura de caixa-alta é única
// por camada, então nada é esticado ou comprimido — só escala uniforme.
//
//   Camada prata (altura 306u):  VAN  (base 362) / GUAR (base 690) / DA (base 1000)
//   Camada colorida (197u):      GEN  (base 588) / DA (base 793), à frente
//   O "A" amarelo ocupa o lugar do A de VAN em tamanho cheio.

const U_TO_WORLD = 1 / 100;
const CENTER_X = 591.8; // centro da caixa total da composição (x 39,5..1144)
const CENTER_Y = 529; //   (y 58..1000)

const SILVER_CAP = 306;
const COLOR_CAP = 197;

// [letra, centro x (u), linha de base (u), altura (u), camada, cor]
const RAW = [
  // --- linha 1: VAN ------------------------------------------------------
  ['V', 262, 362, SILVER_CAP, 'silver'],
  ['A', 409, 362, SILVER_CAP, 'color', 'yellow'], // A de AGENDA, tamanho cheio
  ['N', 720, 362, SILVER_CAP, 'silver'],
  // --- linha 2: GUAR -----------------------------------------------------
  ['G', 192.5, 690, SILVER_CAP, 'silver'],
  ['U', 457.5, 690, SILVER_CAP, 'silver'],
  ['A', 715, 690, SILVER_CAP, 'silver'],
  ['R', 1020, 690, SILVER_CAP, 'silver'],
  // --- linha 3: DA -------------------------------------------------------
  ['D', 770, 1000, SILVER_CAP, 'silver'],
  ['A', 1005, 1000, SILVER_CAP, 'silver'],
  // --- AGENDA (camada da frente) -----------------------------------------
  ['G', 368.5, 588, COLOR_CAP, 'color', 'pink'],
  ['E', 556, 587, COLOR_CAP, 'color', 'blue'],
  ['N', 727.5, 585, COLOR_CAP, 'color', 'orange'],
  ['D', 752, 792, COLOR_CAP, 'color', 'green'],
  ['A', 907.5, 793, COLOR_CAP, 'color', 'purple'],
];

export const PALETTE = {
  yellow: 0xf4b62e,
  pink: 0xe24a8d,
  blue: 0x2c8fd6,
  orange: 0xf2741f,
  green: 0x45b84a,
  purple: 0x9a55d6,
};

// Ordem de leitura de AGENDA
export const AGENDA_ORDER = ['yellow', 'pink', 'blue', 'orange', 'green', 'purple'];

export const LAYOUT = RAW.map(([ch, cx, base, cap, layer, color], i) => ({
  id: i,
  ch,
  layer,
  color: color ?? null,
  cap: cap * U_TO_WORLD,
  // posição do centro do glifo em coordenadas de mundo
  x: (cx - CENTER_X) * U_TO_WORLD,
  y: (CENTER_Y - (base - cap / 2)) * U_TO_WORLD,
  row: base <= 362 ? 0 : base <= 690 ? (layer === 'silver' ? 1 : 1) : 2,
}));

export const COMPOSITION = {
  width: (1144 - 39.5) * U_TO_WORLD,
  height: (1000 - 58) * U_TO_WORLD,
};
