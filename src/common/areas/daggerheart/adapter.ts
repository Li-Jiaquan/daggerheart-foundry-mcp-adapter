/** Adapter for Foundryborne Daggerheart 2.9.4 (system id daggerheart).
 * Plain data only: the module supplies prepared values through adapterData.
 * The module executes the native roll configuration returned by `rolls`.
 */
import {
  isPreparedData,
  type AdapterDocument,
  type CharacterSummary,
  type CreatureFilterSpec,
  type RollRequest,
  type SpellcastingEntry,
  type SystemAdapter,
} from '../../game-systems.js';

type Data = Record<string, unknown>;
const record = (value: unknown): value is Data =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const items = (document: AdapterDocument): Data[] =>
  Array.isArray(document['items']) ? document['items'].filter(record) : [];

/** Accept full documents and Foundry index rows with dotted or nested fields. */
function read(document: AdapterDocument, path: string): unknown {
  if (Object.hasOwn(document, path)) return document[path];
  const parts = path.split('.');
  for (let end = parts.length - 1; end > 0; end--) {
    const prefix = parts.slice(0, end).join('.');
    if (record(document[prefix])) return read(document[prefix], parts.slice(end).join('.'));
  }
  return undefined;
}

export const TRAITS = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'];
export const ADVERSARY_TYPES = [
  'bruiser',
  'horde',
  'leader',
  'minion',
  'ranged',
  'skulk',
  'social',
  'solo',
  'standard',
  'support',
];
const EQUIPMENT = ['weapon', 'armor', 'consumable', 'loot'];
const FEATURES = [
  'feature',
  'ancestry',
  'community',
  'class',
  'subclass',
  'beastform',
  'transformation',
];
const domainCard = (item: AdapterDocument): boolean => item['type'] === 'domainCard';
const spellCard = (item: AdapterDocument): boolean =>
  domainCard(item) && ['spell', 'grimoire'].includes(String(read(item, 'system.type')));

function modifierOf(raw: string | undefined): number {
  const value = (raw ?? '').trim();
  if (!value) return 0;
  const modifier = Number(value.replace(/^\+/, ''));
  if (!Number.isInteger(modifier))
    throw new Error(`rollModifier must be an integer, got "${raw}".`);
  return modifier;
}

function rollPlan(request: RollRequest, actor: AdapterDocument | null) {
  const target = (request.rollTarget ?? '').trim();
  const modifier = modifierOf(request.rollModifier);
  const extraFormula = modifier === 0 ? undefined : String(modifier);
  if (request.rollType === 'custom') {
    if (!target) throw new Error('A custom roll needs its formula in rollTarget, e.g. "1d100".');
    const formula = !request.rollModifier
      ? target
      : /^[+-]/.test(request.rollModifier.trim())
        ? `${target}${request.rollModifier.trim()}`
        : `${target}+${request.rollModifier.trim()}`;
    return { formula, label: 'Custom roll' };
  }
  if (!actor) throw new Error('A Daggerheart system roll needs actorId.');
  if (request.rollType === 'trait') {
    if (!TRAITS.includes(target))
      throw new Error(`rollTarget must be one of ${TRAITS.join(', ')} for a trait roll.`);
    return {
      formula: `2d12${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''}`,
      label: `${target} trait check`,
      native: {
        kind: 'daggerheart-dice-roll',
        config: {
          event: { shiftKey: false, altKey: false, ctrlKey: false },
          title: `${target} trait check`,
          roll: { trait: target, type: 'trait' },
          hasRoll: true,
          actionType: 'action',
          dialog: { configure: false },
          ...(extraFormula ? { extraFormula } : {}),
        },
      },
    };
  }
  if (request.rollType === 'spellcast') {
    const spellcastTrait = text(read(actor, 'system.spellcastModifierTrait.key'));
    return {
      formula: `2d12${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''}`,
      label: 'Spellcast roll',
      native: {
        kind: 'daggerheart-dice-roll',
        config: {
          event: { shiftKey: false, altKey: false, ctrlKey: false },
          title: 'Spellcast roll',
          roll: { type: 'spellcast', ...(spellcastTrait ? { trait: spellcastTrait } : {}) },
          hasRoll: true,
          actionType: 'action',
          dialog: { configure: false },
          ...(extraFormula ? { extraFormula } : {}),
        },
      },
    };
  }
  if (request.rollType === 'attack') {
    if (target && !TRAITS.includes(target))
      throw new Error(
        `rollTarget must be one of ${TRAITS.join(', ')} or omitted for an attack roll.`
      );
    return {
      formula: `2d12${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''}`,
      label: target ? `${target} attack` : 'Attack roll',
      native: {
        kind: 'daggerheart-dice-roll',
        config: {
          event: { shiftKey: false, altKey: false, ctrlKey: false },
          title: target ? `${target} attack` : 'Attack roll',
          roll: { type: 'attack', ...(TRAITS.includes(target) ? { trait: target } : {}) },
          hasRoll: true,
          actionType: 'action',
          dialog: { configure: false },
          ...(extraFormula ? { extraFormula } : {}),
        },
      },
    };
  }
  throw new Error(`Unsupported Daggerheart roll type "${request.rollType}".`);
}

function meter(raw: unknown, marked: boolean, maximumIsFinal = true): Data | null {
  if (!record(raw)) return null;
  const value = number(raw['value']);
  const max = maximumIsFinal ? number(raw['max']) : null;
  return {
    value,
    max,
    meaning: marked ? 'marked' : 'available',
    ...(marked
      ? {
          marked: value,
          remaining: value !== null && max !== null ? Math.max(0, max - value) : null,
        }
      : {}),
  };
}

function thresholds(actor: AdapterDocument): Data | null {
  if (!record(read(actor, 'system.damageThresholds'))) return null;
  return {
    major: number(read(actor, 'system.damageThresholds.major')),
    severe: number(read(actor, 'system.damageThresholds.severe')),
  };
}

export function characterSummary(actor: AdapterDocument): CharacterSummary {
  const type = text(actor['type']);
  const prepared = isPreparedData(actor);
  // Character maxima include class, advancement, effects and world settings.
  // A stored maximum can be only a bonus; do not present it as the final total.
  const derivedAvailable = prepared || !['character', 'companion'].includes(type ?? '');
  const basicInfo: Data = {
    name: actor['name'] ?? null,
    type,
    img: actor['img'] ?? null,
    valuesSource: prepared ? 'prepared' : 'stored',
  };
  if (!derivedAvailable) {
    basicInfo['note'] =
      'Stored values only; traits and experiences may exclude bonuses. Derived defenses, proficiency and resource maxima need a prepared Foundry actor.';
  }
  if (['character', 'companion', 'adversary'].includes(type ?? '')) {
    basicInfo['hitPoints'] = meter(
      read(actor, 'system.resources.hitPoints'),
      true,
      derivedAvailable
    );
    basicInfo['stress'] = meter(read(actor, 'system.resources.stress'), true, derivedAvailable);
  }
  if (type === 'character') {
    basicInfo['level'] = number(read(actor, 'system.levelData.level.current'));
    basicInfo['hope'] = meter(read(actor, 'system.resources.hope'), false, prepared);
    basicInfo['armor'] = prepared ? meter(read(actor, 'system.armorScore'), true) : null;
    basicInfo['proficiency'] = prepared ? number(read(actor, 'system.proficiency')) : null;
    for (const origin of ['class', 'subclass', 'ancestry', 'community']) {
      basicInfo[origin] = items(actor)
        .filter(item => item['type'] === origin)
        .map(item => ({
          name: text(item['name']),
          isMulticlass: read(item, 'system.isMulticlass') === true,
        }));
    }
  }
  if (type === 'character' || type === 'companion') {
    basicInfo['evasion'] = prepared ? number(read(actor, 'system.evasion')) : null;
  }
  if (type === 'character' || type === 'adversary') {
    basicInfo['damageThresholds'] = derivedAvailable ? thresholds(actor) : null;
  }
  if (type === 'adversary' || type === 'environment') {
    basicInfo['tier'] = number(read(actor, 'system.tier'));
    basicInfo[type === 'adversary' ? 'adversaryType' : 'environmentType'] = text(
      read(actor, 'system.type')
    );
  }
  if (['adversary', 'environment', 'npc'].includes(type ?? '')) {
    basicInfo['difficulty'] = number(read(actor, 'system.difficulty'));
  }
  const stats: Data = {};
  if (type === 'character') {
    stats['traits'] = Object.fromEntries(
      TRAITS.map(trait => [
        trait,
        {
          value: number(read(actor, `system.traits.${trait}.value`)),
          tierMarked: read(actor, `system.traits.${trait}.tierMarked`) === true,
        },
      ])
    );
  }
  const experiences = read(actor, 'system.experiences');
  if (record(experiences)) {
    stats['experiences'] = Object.entries(experiences)
      .filter(([, entry]) => record(entry))
      .map(([id, entry]) => ({
        id,
        name: text((entry as Data)['name']),
        value: number((entry as Data)['value']),
      }));
  }
  return { basicInfo, stats };
}

/** Compact item metadata; descriptions and action details stay in get-character-entity. */
export function itemFields(item: AdapterDocument): Data {
  const result: Data = {};
  for (const key of [
    'quantity',
    'tier',
    'level',
    'recallCost',
    'equipped',
    'inVault',
    'domain',
    'burden',
    'secondary',
    'featureForm',
  ]) {
    const value = read(item, `system.${key}`);
    if (typeof value === 'string' || typeof value === 'boolean' || number(value) !== null)
      result[key] = value;
  }
  if (domainCard(item)) result['cardType'] = text(read(item, 'system.type'));
  if (item['type'] === 'armor') {
    result['armor'] = meter(
      { value: read(item, 'system.armor.current'), max: read(item, 'system.armor.max') },
      true
    );
    result['baseThresholds'] = {
      major: number(read(item, 'system.baseThresholds.major')),
      severe: number(read(item, 'system.baseThresholds.severe')),
    };
  }
  return result;
}

/** Domain spells/grimoires are cards, not spell slots; vault cards are not in the loadout. */
export function spellEntries(actor: AdapterDocument): SpellcastingEntry[] {
  const groups = new Map<string, SpellcastingEntry>();
  for (const item of items(actor).filter(spellCard)) {
    const domain = text(read(item, 'system.domain')) || 'unknown';
    const group = groups.get(domain) ?? {
      id: `domain:${domain}`,
      name: domain,
      kind: 'domain-cards',
      tradition: domain,
      spells: [],
    };
    const inVault = read(item, 'system.inVault');
    group.spells.push({
      id: text(item['_id']) ?? text(item['id']) ?? '',
      name: text(item['name']) ?? '',
      level: number(read(item, 'system.level')),
      ...(typeof inVault === 'boolean' ? { prepared: !inVault } : {}),
      traits: [String(read(item, 'system.type'))],
    });
    groups.set(domain, group);
  }
  return [...groups.values()];
}

export function actorStats(actor: AdapterDocument): Data | null {
  if (!['adversary', 'environment'].includes(String(actor['type']))) return null;
  const result: Data = {
    tier: number(read(actor, 'system.tier')),
    difficulty: number(read(actor, 'system.difficulty')),
    [actor['type'] === 'adversary' ? 'adversaryType' : 'environmentType']: text(
      read(actor, 'system.type')
    ),
  };
  if (actor['type'] === 'adversary') {
    result['hitPoints'] = number(read(actor, 'system.resources.hitPoints.max'));
    result['stress'] = number(read(actor, 'system.resources.stress.max'));
    result['damageThresholds'] = {
      major: number(read(actor, 'system.damageThresholds.major')),
      severe: number(read(actor, 'system.damageThresholds.severe')),
    };
    result['attackBonus'] = number(read(actor, 'system.attack.roll.bonus'));
  }
  return result;
}

export const INDEX_FIELDS = [
  'system.tier',
  'system.type',
  'system.difficulty',
  'system.resources.hitPoints.max',
  'system.resources.stress.max',
  'system.damageThresholds.major',
  'system.damageThresholds.severe',
  'system.attack.roll.bonus',
];
const FILTERS: CreatureFilterSpec[] = [
  { name: 'tier', kind: 'numberOrRange', field: 'tier', defaults: { min: 1, max: 4 } },
  { name: 'adversaryType', kind: 'text', field: 'adversaryType', values: ADVERSARY_TYPES },
  {
    name: 'difficulty',
    kind: 'numberOrRange',
    field: 'difficulty',
    defaults: { min: 0, max: 100 },
  },
  {
    name: 'hitPoints',
    kind: 'numberOrRange',
    field: 'hitPoints',
    defaults: { min: 0, max: 10000 },
  },
  { name: 'stress', kind: 'numberOrRange', field: 'stress', defaults: { min: 0, max: 10000 } },
];

export const SCHEMA_NOTES = [
  'Foundryborne Daggerheart 2.9.4 (system id daggerheart).',
  'Actor types: character, adversary, companion, npc, environment, party.',
  'Character: system.levelData.level.current; system.traits.<agility|strength|finesse|instinct|presence|knowledge>.value.',
  'system.resources.hitPoints.value and stress.value are MARKED slots (0 is undamaged/unstressed); hope.value is AVAILABLE Hope.',
  'Character resource maxima, evasion, proficiency and damageThresholds include prepared class, advancement and effect values. Stored numbers may be bonuses; do not write prepared totals back.',
  'Character armorScore is derived. Worn armor uses item.system.armor.current (marked) and armor.max, plus baseThresholds.major/severe.',
  'Adversary: system.tier, system.type (role), difficulty, damageThresholds.major/severe, resources.hitPoints/stress, attack.roll.bonus.',
  'Experiences: system.experiences.<id>.name and .value. Origins are embedded class, subclass, ancestry and community items.',
  'Domain cards: type domainCard; system.domain, level, type (ability/spell/grimoire), recallCost and inVault. Recall cost is not a casting cost.',
  'Input system data is preserved without shorthand conversion. Native trait, spellcast and attack rolls use the system Duality Roll; Hope/Fear automation is applied by the module after the roll.',
].join('\n');

export const daggerheartAdapter: SystemAdapter = {
  id: 'daggerheart',
  title: 'Daggerheart',
  characters: { summary: characterSummary, itemFields },
  spells: { itemTypes: ['domainCard'], entries: spellEntries },
  characterSearch: {
    itemTypes: {
      spells: ['domainCard'],
      equipment: EQUIPMENT,
      features: FEATURES,
      actions: ['weapon', 'feature', 'domainCard'],
    },
    categories: {
      all: { description: 'Every embedded item', matches: () => true },
      items: {
        description: 'Weapons, armor, consumables and loot',
        matches: item => EQUIPMENT.includes(String(item['type'])),
      },
      equipment: {
        description: 'Weapons, armor, consumables and loot',
        matches: item => EQUIPMENT.includes(String(item['type'])),
      },
      features: {
        description: 'Features and character origins',
        matches: item => FEATURES.includes(String(item['type'])),
      },
      spells: { description: 'Spell and grimoire domain cards', matches: spellCard },
      domainCards: { description: 'All domain cards, including abilities', matches: domainCard },
      loadout: {
        description: 'Domain cards outside the vault',
        matches: item => domainCard(item) && read(item, 'system.inVault') === false,
      },
      vault: {
        description: 'Domain cards in the vault',
        matches: item => domainCard(item) && read(item, 'system.inVault') === true,
      },
      equipped: {
        description: 'Equipped weapons and armor',
        matches: item =>
          ['weapon', 'armor'].includes(String(item['type'])) &&
          read(item, 'system.equipped') === true,
      },
    },
    matchDetails: itemFields,
  },
  rolls: {
    types: [
      {
        id: 'trait',
        description: 'native Duality Roll for one of the six traits',
        targets: TRAITS,
      },
      { id: 'spellcast', description: 'native Daggerheart spellcast Duality Roll' },
      {
        id: 'attack',
        description: 'native base Daggerheart attack Duality Roll; rollTarget may name its trait',
        targets: TRAITS,
      },
      { id: 'custom', description: 'the formula in rollTarget' },
    ],
    plan: rollPlan,
  },
  creatures: {
    indexVersion: 1,
    actorTypes: ['adversary'],
    invalidatingTypes: ['adversary'],
    copyableTypes: ['character', 'adversary', 'companion', 'npc', 'environment', 'party'],
    row: actor => actorStats(actor) ?? {},
    power: { name: 'Tier', field: 'tier', range: { min: 1, max: 4 } },
    filters: FILTERS,
    listFields: row =>
      Object.fromEntries(
        [
          'tier',
          'adversaryType',
          'difficulty',
          'hitPoints',
          'stress',
          'damageThresholds',
          'attackBonus',
        ].map(key => [key, row[key] ?? null])
      ),
    summary: row =>
      `Tier ${String(row['tier'] ?? '?')} ${String(row['adversaryType'] ?? 'adversary')} from ${row.packLabel}`,
  },
  compendiumStats: { indexFields: INDEX_FIELDS, actorStats },
  actorData: { schemaNotes: () => SCHEMA_NOTES },
  compendiums: { priority: packId => (packId.startsWith('daggerheart.') ? 1 : 0) },
};
