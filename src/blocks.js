export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  LOG: 5,
  LEAF: 6,
  SNOW: 7,
  BEDROCK: 8,
  WATER: 9,
  PLANKS: 10,
  GLASS: 11,
  BRICK: 12,
  COAL_ORE: 13,
  IRON_ORE: 14,
  GOLD_ORE: 15,
  DIAMOND_ORE: 16,
  CRAFTING_TABLE: 17
};

// Texture atlas tiles (8 columns x 4 rows of 16px tiles)
const T = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4,
  LOG_SIDE: 5, LOG_TOP: 6, LEAF: 7,
  SNOW: 8, BEDROCK: 9, WATER: 10, PLANKS: 11,
  GLASS: 12, BRICK: 13, COAL: 14, IRON: 15,
  GOLD: 16, DIAMOND: 17, TABLE_TOP: 18, TABLE_SIDE: 19
};

export const BLOCK_INFO = {
  [B.GRASS]: { name: 'block.grass', color: '#5fae4a', tiles: { top: T.GRASS_TOP, side: T.GRASS_SIDE, bottom: T.DIRT } },
  [B.DIRT]: { name: 'block.dirt', color: '#7a5230', tiles: { top: T.DIRT, side: T.DIRT, bottom: T.DIRT } },
  [B.STONE]: { name: 'block.stone', color: '#8b9096', tiles: { top: T.STONE, side: T.STONE, bottom: T.STONE } },
  [B.SAND]: { name: 'block.sand', color: '#e0cf8e', tiles: { top: T.SAND, side: T.SAND, bottom: T.SAND } },
  [B.LOG]: { name: 'block.log', color: '#6b4a2b', tiles: { top: T.LOG_TOP, side: T.LOG_SIDE, bottom: T.LOG_TOP } },
  [B.LEAF]: { name: 'block.leaf', color: '#3e8f3a', tiles: { top: T.LEAF, side: T.LEAF, bottom: T.LEAF } },
  [B.SNOW]: { name: 'block.snow', color: '#f2f6fa', tiles: { top: T.SNOW, side: T.SNOW, bottom: T.SNOW } },
  [B.BEDROCK]: { name: 'block.bedrock', color: '#3a3d42', tiles: { top: T.BEDROCK, side: T.BEDROCK, bottom: T.BEDROCK } },
  [B.WATER]: { name: 'block.water', color: '#3f7fd6', tiles: { top: T.WATER, side: T.WATER, bottom: T.WATER } },
  [B.PLANKS]: { name: 'block.planks', color: '#b08a54', tiles: { top: T.PLANKS, side: T.PLANKS, bottom: T.PLANKS } },
  [B.GLASS]: { name: 'block.glass', color: '#cfe8f5', tiles: { top: T.GLASS, side: T.GLASS, bottom: T.GLASS } },
  [B.BRICK]: { name: 'block.brick', color: '#9c5a48', tiles: { top: T.BRICK, side: T.BRICK, bottom: T.BRICK } },
  [B.COAL_ORE]: { name: 'block.coal', color: '#4a4f55', tiles: { top: T.COAL, side: T.COAL, bottom: T.COAL } },
  [B.IRON_ORE]: { name: 'block.iron', color: '#d8af93', tiles: { top: T.IRON, side: T.IRON, bottom: T.IRON } },
  [B.GOLD_ORE]: { name: 'block.gold', color: '#f5d95a', tiles: { top: T.GOLD, side: T.GOLD, bottom: T.GOLD } },
  [B.DIAMOND_ORE]: { name: 'block.diamond', color: '#5ad8e8', tiles: { top: T.DIAMOND, side: T.DIAMOND, bottom: T.DIAMOND } },
  [B.CRAFTING_TABLE]: { name: 'block.table', color: '#a07840', tiles: { top: T.TABLE_TOP, side: T.TABLE_SIDE, bottom: T.PLANKS } }
};

export function isSolid(b) {
  return b !== B.AIR && b !== B.WATER;
}

export function isOpaque(b) {
  return b !== B.AIR && b !== B.WATER && b !== B.LEAF && b !== B.GLASS;
}

// Block types available in the hotbar
export const HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.SAND, B.PLANKS, B.LOG, B.GLASS, B.BRICK, B.LEAF, B.CRAFTING_TABLE];
