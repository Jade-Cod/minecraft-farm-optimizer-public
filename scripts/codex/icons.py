"""Icon rules for items known only by display name (wiki kits and wiki-only crates).

Captured items carry their real item id, which is the icon file name, so they
don't need these. Stems name files in frontend/icons; build_codex.py --fetch-icons
downloads any that are missing.
"""

# item name (lowercase, singular-ish) -> icon file stem. Order matters: first hit wins.
ICON_RULES = [
    (r'netherite hoe', 'netherite_hoe'), (r'diamond hoe', 'diamond_hoe'), (r'iron hoe', 'iron_hoe'),
    (r'golden hoe', 'golden_hoe'), (r'stone hoe', 'stone_hoe'), (r'wooden hoe', 'wooden_hoe'),
    (r'golden pickaxe', 'golden_pickaxe'), (r'golden axe', 'golden_axe'), (r'golden shovel', 'golden_shovel'),
    (r'golden boots', 'golden_boots'), (r'golden carrot', 'golden_carrot'), (r'golden apple', 'golden_apple'),
    (r'gold nugget', 'gold_nugget'), (r'gold ingot', 'gold_ingot'),
    (r'iron sword', 'iron_sword'), (r'iron pickaxe', 'iron_pickaxe'), (r'iron shovel', 'iron_shovel'),
    (r'iron axe', 'iron_axe'), (r'iron nugget', 'iron_nugget'), (r'iron armour', 'iron_chestplate'),
    (r'diamond sword', 'diamond_sword'), (r'diamond pickaxe', 'diamond_pickaxe'),
    (r'diamond shovel', 'diamond_shovel'), (r'diamond axe', 'diamond_axe'), (r'diamond boots', 'diamond_boots'),
    (r'diamond armour', 'diamond_chestplate'), (r'junky armour', 'leather_chestplate'),
    (r'leather boots', 'leather_boots'), (r'trident', 'trident'),
    (r'fishing rod', 'fishing_rod'), (r'bow\b', 'bow'), (r'arrow', 'arrow'),
    (r'steak', 'cooked_beef'), (r'boat', 'boat'), (r'wheat seed', 'wheat_seeds'), (r'wheat', 'wheat'),
    (r'beetroot seed', 'beetroot_seeds'), (r'beetroot', 'beetroot'), (r'cocoa', 'cocoa_beans'), (r'poisonous potato', 'poisonous_potato'),
    (r'carrot', 'carrot'), (r'potato', 'potato'), (r'nether wart', 'nether_wart'), (r'sugar cane', 'reeds'),
    (r'chorus flower', 'block/chorus_flower'), (r'chorus', 'chorus_fruit'), (r'glow berr', 'glow_berries'), (r'sweet berr', 'sweet_berries'),
    (r'pumpkin seed', 'pumpkin_seeds'), (r'melon seed', 'melon_seeds'), (r'glistering', 'glistering_melon_slice'),
    (r'water bucket', 'water_bucket'), (r'milk bucket', 'milk_bucket'), (r'bucket', 'bucket'),
    (r'lapis', 'lapis_lazuli'), (r'white dye', 'white_dye'), (r'light gray dye', 'light_gray_dye'),
    (r'gray dye', 'gray_dye'), (r'pink dye', 'pink_dye'), (r'magenta dye', 'magenta_dye'), (r'red dye', 'red_dye'),
    (r'purple dye', 'purple_dye'), (r'cyan dye', 'cyan_dye'), (r'light blue dye', 'light_blue_dye'),
    (r'lime dye', 'lime_dye'), (r'green dye', 'green_dye'), (r'yellow dye', 'yellow_dye'), (r'orange dye', 'orange_dye'),
    (r'glass bottle', 'glass_bottle'), (r'water bottle|bottles of water', 'potion'), (r'honey bottle', 'honey_bottle'),
    (r'splash potion', 'splash_potion'), (r'potion', 'potion'), (r'blaze rod', 'blaze_rod'),
    (r"dragon's breath", 'dragon_breath'), (r'gunpowder', 'gunpowder'), (r'sugar', 'sugar'),
    (r'redstone dust', 'redstone'), (r'repeater', 'repeater'), (r'comparator', 'comparator'),
    (r'glowstone dust', 'glowstone_dust'), (r"rabbit's foot", 'rabbit_foot'), (r'rabbit hide', 'rabbit_hide'),
    (r'ghast tear', 'ghast_tear'), (r'phantom membrane', 'phantom_membrane'), (r'firework', 'firework_rocket'),
    (r'ender ?pearl', 'ender_pearl'), (r'spyglass', 'spyglass'), (r'bone', 'bone'), (r'apple', 'apple'),
    (r'chests?\b', 'chest_minecart'), (r'oak sign', 'sign'), (r'hopper', 'hopper'), (r'clock', 'clock'),
    (r'kelp', 'kelp'), (r'brewing stand', 'brewing_stand'),
    # crate items
    (r'helmet|cap\b|mask|scuba', 'diamond_helmet'), (r'chestplate|chest$|tank top|cloak|vest', 'diamond_chestplate'),
    (r'leggings|pants|speedo', 'diamond_leggings'),
    (r'boots|shoes|sneakers|cleats|walkers', 'diamond_boots'), (r'armor set', 'diamond_chestplate'),
    (r'halberd', 'diamond_axe'), (r'sword|rapier|stiletto|claw|overkiller|materializer|web slinger|noodle', 'diamond_sword'),
    (r'hex shooter', 'crossbow_standby'), (r'compound bow|voter bow', 'bow'),
    (r'paxel|drill|jackhammer|pickaxe|flurry pick|cocobinator', 'diamond_pickaxe'), (r'shovel', 'diamond_shovel'),
    (r'axe\b', 'diamond_axe'), (r'hoe|herbalizer|plow|farmer|harvester', 'diamond_hoe'),
    (r'fryer|legacy of chuck', 'fishing_rod'), (r'stew', 'mushroom_stew'), (r'spawner', 'spawn_egg'),
    (r'crate key|key', 'name_tag'), (r'^\$', 'gold_ingot'), (r'exp\b|exp juice', 'experience_bottle'),
    (r'mcmmo|smelling salts', 'enchanted_book'), (r'vote token', 'emerald'), (r'insta-grow', 'bone_meal'),
    (r'scrap', 'iron_nugget'), (r'rocket', 'firework_rocket'), (r'mount|saddle', 'saddle'),
    (r'wraith', 'saddle'), (r'farming access', 'wheat'), (r'beacon', 'block/beacon'), (r'snowglobe', 'nether_star'),
    (r'catalyst', 'amethyst_shard'), (r'constructor', 'blaze_powder'), (r'volumizer', 'emerald'), (r'satchel|sack', 'leather'),
    (r'whetstone|slate', 'flint'), (r'bait|chum', 'cod'), (r'bell', 'bell'), (r'radar', 'compass'),
    (r'caltr?ops', 'large_amethyst_bud'), (r'bomb|charge', 'fire_charge'), (r'magnet|extractor|smelt|smelter', 'iron_ingot'),
    (r'compactor', 'wheat'), (r'brightener|visibility', 'glowstone_dust'), (r'pocket|mausoleum|tombstone', 'paper'),
    (r'blower', 'glass_bottle'), (r'skull', 'skull_skeleton'), (r'paddle', 'stick'),
    (r'whip', 'lead'), (r'geo.generator', 'block/magenta_glazed_terracotta'), (r'umbrella|paddle', 'stick'),
    (r'sunscreen', 'potion'), (r'jetski', 'dark_oak_boat'), (r'dolphin fin', 'prismarine_shard'), (r'mistletoe', 'sweet_berries'), (r'cocoa|candy', 'cookie'), (r'haunter', 'skull_zombie'),
]
# block names in kit lists. "block/x" is a 3D inventory render (blocks3d.py); plain
# stems are flat sprites, for blocks the game also shows flat (torch, ladder, pane...).
# Longest key wins, so "redstone torch" beats "torch".
BLOCKS = {
    'cactus': 'block/cactus', 'dirt': 'block/dirt', 'sand': 'block/sand', 'scaffolding': 'block/scaffolding',
    'stone': 'block/stone', 'torch': 'torch', 'tnt': 'block/tnt', 'stone brick': 'block/stone_bricks',
    'smooth stone slab': 'block/smooth_stone_slab', 'stone button': 'block/stone_button', 'piston': 'block/piston',
    'ice': 'block/ice', 'sponge': 'block/sponge', 'magma': 'block/magma_block', 'soul sand': 'block/soul_sand',
    'glass pane': 'glass', 'glass': 'block/glass', 'slime block': 'block/slime_block', 'observer': 'block/observer',
    'redstone lamp': 'block/redstone_lamp', 'redstone torch': 'redstone_torch', 'coal block': 'block/coal_block',
    'oak log': 'block/oak_log', 'jungle log': 'block/jungle_log', 'ladder': 'ladder',
    'red concrete': 'block/red_concrete', 'yellow concrete': 'block/yellow_concrete',
    'lime concrete': 'block/lime_concrete', 'obsidian': 'block/obsidian', 'end rod': 'end_rod',
    'sea lantern': 'block/sea_lantern', 'glowstone': 'block/glowstone', 'cobweb': 'cobweb',
    'dispenser': 'block/dispenser', 'end stone': 'block/end_stone', 'brown mushroom': 'brown_mushroom',
    'red mushroom': 'red_mushroom', 'grass': 'short_grass',
}
