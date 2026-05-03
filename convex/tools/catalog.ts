/**
 * Catálogo de tools FATE no formato OpenRouter/OpenAI function calling.
 * Cada tool corresponde a uma mecânica FATE que o GM pode invocar durante a narrativa.
 */

export type FateTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
};

export const FATE_TOOLS: FateTool[] = [
  {
    type: "function",
    function: {
      name: "roll_fate_dice",
      description:
        "Rola 4 dados FATE (+/-/0) adicionando o nível de habilidade do personagem. Use sempre que uma ação do personagem tiver oposição significativa ou resultado incerto.",
      parameters: {
        type: "object",
        properties: {
          skillName: {
            type: "string",
            description: "Nome da habilidade usada (ex: 'Combate', 'Atletismo').",
          },
          skillLevel: {
            type: "number",
            description: "Valor numérico da habilidade (ex: 3 para Good+3).",
          },
          description: {
            type: "string",
            description: "Descrição narrativa do que o personagem está tentando fazer.",
          },
          seed: {
            type: "string",
            description:
              "String única para determinismo da rolagem. Use timestamp + nome da ação (ex: '1704067200000-combate').",
          },
          type: {
            type: "string",
            enum: ["attack", "defend", "overcome", "create_advantage"],
            description: "Tipo da ação FATE.",
          },
          opposition: {
            type: "number",
            description:
              "Valor de oposição passiva ou dificuldade fixa. Omitir para oposição ativa (outra rolagem).",
          },
        },
        required: ["skillName", "skillLevel", "description", "seed", "type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "invoke_aspect",
      description:
        "Invoca um aspecto de cena para dar +2 ou relançar os dados em uma rolagem. Gasta uma invocação gratuita ou 1 Ponto de Destino.",
      parameters: {
        type: "object",
        properties: {
          aspectId: {
            type: "string",
            description: "ID do aspecto de cena a ser invocado.",
          },
          effect: {
            type: "string",
            enum: ["bonus_2", "reroll"],
            description: "'bonus_2' adiciona +2 ao total; 'reroll' relança todos os dados.",
          },
          rollId: {
            type: "string",
            description: "ID da rolagem de dados à qual esta invocação se aplica.",
          },
        },
        required: ["aspectId", "effect", "rollId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compel_aspect",
      description:
        "Compele um aspecto do personagem, oferecendo 1 Ponto de Destino em troca de uma complicação narrativa. O jogador pode aceitar ou recusar (gastando 1 PD para recusar).",
      parameters: {
        type: "object",
        properties: {
          aspectId: {
            type: "string",
            description: "ID do aspecto de cena que está sendo compelido.",
          },
          characterId: {
            type: "string",
            description: "ID do personagem do jogador que está sendo compelido.",
          },
          complication: {
            type: "string",
            description:
              "Descrição da complicação proposta — o que de ruim (narrativamente interessante) aconteceria se o personagem aceitar.",
          },
        },
        required: ["aspectId", "characterId", "complication"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_stress",
      description:
        "Aplica stress físico ou mental ao personagem como resultado de um ataque bem-sucedido ou situação traumática.",
      parameters: {
        type: "object",
        properties: {
          characterId: {
            type: "string",
            description: "ID do personagem que recebe o stress.",
          },
          amount: {
            type: "number",
            description: "Quantidade de stress a aplicar (geralmente shifts do ataque).",
          },
          track: {
            type: "string",
            enum: ["physical", "mental"],
            description: "Trilha de stress afetada.",
          },
        },
        required: ["characterId", "amount", "track"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_consequence",
      description:
        "Aplica uma consequência ao personagem. Use quando o personagem não pode absorver todo o stress e escolhe sofrer uma consequência para reduzir o dano.",
      parameters: {
        type: "object",
        properties: {
          characterId: {
            type: "string",
            description: "ID do personagem que recebe a consequência.",
          },
          severity: {
            type: "string",
            enum: ["mild", "moderate", "severe"],
            description:
              "'mild' absorve 2 stress, 'moderate' absorve 4, 'severe' absorve 6.",
          },
          description: {
            type: "string",
            description:
              "Descrição narrativa da consequência (ex: 'Tornozelo torcido', 'Abalado emocionalmente').",
          },
        },
        required: ["characterId", "severity", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "award_fate_point",
      description:
        "Concede 1 Ponto de Destino ao personagem do jogador. Use em situações de recompensa narrativa fora do sistema normal de compels.",
      parameters: {
        type: "object",
        properties: {
          characterId: {
            type: "string",
            description: "ID do personagem que recebe o Ponto de Destino.",
          },
          reason: {
            type: "string",
            description: "Razão narrativa pela qual o ponto está sendo concedido.",
          },
        },
        required: ["characterId", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "spend_fate_point",
      description:
        "Gasta 1 Ponto de Destino do personagem. Use quando o GM aciona um benefício que custa PD (ex: invocação de aspecto de personagem).",
      parameters: {
        type: "object",
        properties: {
          characterId: {
            type: "string",
            description: "ID do personagem que gasta o Ponto de Destino.",
          },
          reason: {
            type: "string",
            description: "Razão pelo qual o ponto está sendo gasto.",
          },
        },
        required: ["characterId", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_scene_aspect",
      description:
        "Adiciona um novo aspecto à cena atual. Use para estabelecer vantagens criadas, condições ambientais ou elementos narrativos importantes.",
      parameters: {
        type: "object",
        properties: {
          sceneId: {
            type: "string",
            description: "ID da cena onde o aspecto será adicionado.",
          },
          text: {
            type: "string",
            description:
              "Texto do aspecto (ex: 'Chão Escorregadio', 'Fogo se Espalhando').",
          },
          freeInvokes: {
            type: "number",
            description:
              "Número de invocações gratuitas concedidas. Default: 0. Use 1 ou 2 para vantagens criadas com sucesso.",
          },
        },
        required: ["sceneId", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "change_scene",
      description:
        "Encerra a cena atual e inicia uma nova. Use para transições narrativas significativas — mudança de local, passagem de tempo, novo conflito.",
      parameters: {
        type: "object",
        properties: {
          campaignId: {
            type: "string",
            description: "ID da campanha.",
          },
          title: {
            type: "string",
            description: "Título da nova cena (ex: 'A Taverna do Dragão Cansado').",
          },
          description: {
            type: "string",
            description:
              "Descrição da nova cena — ambiente, tom, NPCs presentes, elementos relevantes.",
          },
        },
        required: ["campaignId", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reveal_fact",
      description:
        "Revela um fato previamente oculto ao jogador. Use quando o personagem descobre informação secreta através de ação, exploração ou evento narrativo.",
      parameters: {
        type: "object",
        properties: {
          factId: {
            type: "string",
            description: "ID do fato a ser revelado.",
          },
        },
        required: ["factId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reveal_entity",
      description:
        "Revela uma entidade (NPC, local, facção ou item) previamente oculta ou apenas rumored ao jogador.",
      parameters: {
        type: "object",
        properties: {
          entityId: {
            type: "string",
            description: "ID da entidade a ser revelada.",
          },
        },
        required: ["entityId"],
      },
    },
  },
];

/**
 * Retorna o array completo de tools FATE para passar ao LLM.
 */
export function getFateTools(): FateTool[] {
  return FATE_TOOLS;
}

/**
 * Retorna uma tool específica pelo nome, ou undefined se não encontrada.
 */
export function getFateTool(name: string): FateTool | undefined {
  return FATE_TOOLS.find((t) => t.function.name === name);
}
