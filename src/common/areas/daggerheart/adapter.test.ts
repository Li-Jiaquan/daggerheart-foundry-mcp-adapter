import { describe, expect, it } from 'vitest';
import { SystemAdapterRegistry } from '../../game-systems.js';
import { adapterData } from '../../../module/prepared-data.js';
import { matchesAll, readFilters } from '../../../module/areas/compendiums/filters.js';
import {
  actorStats,
  characterSummary,
  daggerheartAdapter,
  INDEX_FIELDS,
  itemFields,
  spellEntries,
} from './adapter.js';

// Synthetic fixtures following the installed Foundryborne 2.9.4 schema.
const character = () => ({
  name: 'Test Scout',
  type: 'character',
  preparedData: true,
  system: {
    levelData: { level: { current: 3 } },
    proficiency: 2,
    evasion: 12,
    traits: { agility: { value: 3, tierMarked: true }, strength: { value: -1 } },
    resources: {
      hitPoints: { value: 2, max: 6 },
      stress: { value: 0, max: 6 },
      hope: { value: 4, max: 6 },
    },
    armorScore: { value: 1, max: 3 },
    damageThresholds: { major: 8, severe: 17 },
    experiences: { scout: { name: 'Forest Scout', value: 2 } },
  },
  items: [{ _id: 'class1', name: 'Test Class', type: 'class', system: { isMulticlass: false } }],
});
const adversary = () => ({
  name: 'Test Sentinel',
  type: 'adversary',
  system: {
    tier: 2,
    type: 'standard',
    difficulty: 14,
    resources: { hitPoints: { value: 1, max: 5 }, stress: { value: 0, max: 3 } },
    damageThresholds: { major: 10, severe: 20 },
    attack: { roll: { bonus: 2 } },
  },
});
const card = (id: string, type: string, inVault: boolean) => ({
  _id: id,
  name: id,
  type: 'domainCard',
  system: { domain: 'arcana', type, inVault, level: 2, recallCost: 1 },
});

describe('Daggerheart characters', () => {
  it('distinguishes marked tracks from available Hope, and preserves zero and negative traits', () => {
    expect(characterSummary(character())).toMatchObject({
      basicInfo: {
        level: 3,
        evasion: 12,
        proficiency: 2,
        valuesSource: 'prepared',
        hitPoints: { value: 2, max: 6, marked: 2, remaining: 4, meaning: 'marked' },
        stress: { value: 0, remaining: 6 },
        hope: { value: 4, max: 6, meaning: 'available' },
        armor: { marked: 1, remaining: 2 },
        damageThresholds: { major: 8, severe: 17 },
        class: [{ name: 'Test Class', isMulticlass: false }],
      },
      stats: {
        traits: { agility: { value: 3, tierMarked: true }, strength: { value: -1 } },
        experiences: [{ id: 'scout', name: 'Forest Scout', value: 2 }],
      },
    });
  });

  it('does not mistake stored bonuses for derived totals or guess a Hope maximum', () => {
    const actor = character();
    actor.preparedData = false;
    expect(characterSummary(actor).basicInfo).toMatchObject({
      valuesSource: 'stored',
      evasion: null,
      proficiency: null,
      armor: null,
      hitPoints: { value: 2, max: null, remaining: null },
      hope: { max: null },
      damageThresholds: null,
      note: expect.stringContaining('prepared Foundry actor'),
    });
  });

  it('uses prepared class/effect totals without applying bonuses a second time', () => {
    const source = character();
    source.preparedData = false;
    const live = {
      ...source.system,
      evasion: 15,
      resources: { ...source.system.resources, hitPoints: { value: 2, max: 9 } },
    };
    const result = characterSummary(
      adapterData({ toObject: () => structuredClone(source), system: live })
    );
    expect(result.basicInfo).toMatchObject({
      valuesSource: 'prepared',
      evasion: 15,
      hitPoints: { max: 9, remaining: 7 },
    });
  });

  it('reads adversaries without giving them character-only resources', () => {
    const summary = characterSummary(adversary());
    expect(summary.basicInfo).toMatchObject({
      tier: 2,
      adversaryType: 'standard',
      difficulty: 14,
      hitPoints: { remaining: 4 },
    });
    expect(summary.basicInfo).not.toHaveProperty('hope');
    expect(summary.basicInfo).not.toHaveProperty('evasion');
    expect(summary.stats).not.toHaveProperty('traits');
  });

  it.each(['npc', 'environment', 'party', 'companion', 'unknown'])(
    'handles sparse %s actors',
    type => {
      const result = characterSummary({ type, system: null, items: [null, 'bad'] });
      expect(result.basicInfo['type']).toBe(type);
      expect(result.stats).toEqual({});
      expect(result.basicInfo).not.toHaveProperty('hope');
    }
  );

  it('does not invent numeric values for malformed fields', () => {
    const result = characterSummary({
      type: 'character',
      preparedData: true,
      system: {
        evasion: NaN,
        traits: { agility: { value: '3' } },
        resources: { stress: { value: Infinity, max: null } },
      },
    });
    expect(result.basicInfo['evasion']).toBeNull();
    expect(result.basicInfo['stress']).toMatchObject({ value: null, max: null, remaining: null });
    expect(result.stats['traits']).toMatchObject({ agility: { value: null } });
  });

  it('does not mutate actor or item input', () => {
    const actor = character();
    const before = structuredClone(actor);
    characterSummary(actor);
    spellEntries(actor);
    actor.items.forEach(itemFields);
    expect(actor).toEqual(before);
  });
});

describe('Daggerheart cards and equipment', () => {
  it('groups spells and grimoires, excludes abilities, and does not invent spell slots or casting costs', () => {
    const entries = spellEntries({
      items: [
        card('spell', 'spell', false),
        card('book', 'grimoire', true),
        card('ability', 'ability', false),
      ],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'domain-cards',
      tradition: 'arcana',
      spells: [
        { id: 'spell', prepared: true, traits: ['spell'] },
        { id: 'book', prepared: false, traits: ['grimoire'] },
      ],
    });
    expect(entries[0]).not.toHaveProperty('slots');
    expect(entries[0]!.spells[0]).not.toHaveProperty('cost');
    expect(entries[0]!.spells[1]).not.toHaveProperty('expended');
  });

  it('does not claim loadout membership when the vault flag is absent', () => {
    const item = { type: 'domainCard', system: { type: 'spell' } };
    expect(spellEntries({ items: [item] })[0]!.spells[0]).not.toHaveProperty('prepared');
    expect(daggerheartAdapter.characterSearch!.categories['loadout']!.matches(item)).toBe(false);
  });

  it('filters domain abilities, vault, spells, and equipment separately', () => {
    const categories = daggerheartAdapter.characterSearch!.categories;
    const ability = card('ability', 'ability', false);
    expect(categories['spells']!.matches(ability)).toBe(false);
    expect(categories['domainCards']!.matches(ability)).toBe(true);
    expect(categories['loadout']!.matches(ability)).toBe(true);
    expect(categories['vault']!.matches(card('spell', 'spell', true))).toBe(true);
    expect(categories['equipped']!.matches({ type: 'weapon', system: { equipped: false } })).toBe(
      false
    );
    expect(categories['equipment']!.matches({ type: 'loot' })).toBe(true);
  });

  it('reads armor.current and keeps the recall cost separate from a casting cost', () => {
    expect(
      itemFields({
        type: 'armor',
        system: {
          equipped: true,
          armor: { current: 0, max: 3 },
          baseThresholds: { major: 7, severe: 15 },
        },
      })
    ).toMatchObject({
      equipped: true,
      armor: { value: 0, max: 3, remaining: 3 },
      baseThresholds: { major: 7, severe: 15 },
    });
    expect(itemFields(card('spell', 'spell', true))).toMatchObject({
      cardType: 'spell',
      recallCost: 1,
      inVault: true,
    });
    expect(itemFields({ system: null })).toEqual({});
  });
});

describe('Daggerheart creature index and registry', () => {
  it('reads nested, fully dotted and partially dotted index fields consistently', () => {
    const actor = adversary();
    const flat = {
      type: 'adversary',
      'system.tier': 2,
      'system.type': 'standard',
      'system.difficulty': 14,
      'system.resources.hitPoints.max': 5,
      'system.resources.stress.max': 3,
      'system.damageThresholds.major': 10,
      'system.damageThresholds.severe': 20,
      'system.attack.roll.bonus': 2,
    };
    expect(actorStats(flat)).toEqual(actorStats(actor));
    expect(
      actorStats({ type: 'adversary', 'system.resources': actor.system.resources })
    ).toMatchObject({ hitPoints: 5, stress: 3 });
    expect(INDEX_FIELDS.every(field => Object.hasOwn(flat, field))).toBe(true);
  });

  it('uses tier, role and difficulty with the existing filter engine', () => {
    const filters = readFilters(
      daggerheartAdapter.creatures!.filters,
      { tier: { min: 2, max: 3 }, adversaryType: 'STANDARD', difficulty: 14 },
      () => 'unknown'
    );
    expect(filters.problems).toEqual([]);
    expect(matchesAll(filters.active, actorStats(adversary())!)).toBe(true);
    expect(matchesAll(filters.active, { ...actorStats(adversary()), tier: 1 })).toBe(false);
    expect(daggerheartAdapter.creatures!.actorTypes).toEqual(['adversary']);
    expect(actorStats({ type: 'character' })).toBeNull();
    expect(
      actorStats({ type: 'environment', system: { tier: 2, type: 'traversal', difficulty: 0 } })
    ).toEqual({ tier: 2, environmentType: 'traversal', difficulty: 0 });
  });

  it('claims only the official system id and builds native and custom rolls', () => {
    const registry = new SystemAdapterRegistry();
    registry.register(daggerheartAdapter);
    expect(registry.find('DAGGERHEART')).toBe(daggerheartAdapter);
    expect(registry.find('daggerheart-unofficial')).toBeNull();
    const system = registry.describe('daggerheart');
    expect(system.capabilities).toEqual({
      creatureIndex: true,
      characterStats: true,
      spells: true,
      powerMeasure: true,
    });
    const rolls = registry.answer(system, 'rolls');
    expect(rolls.fromAdapter).toBe(true);
    const trait = rolls.questions.plan(
      { rollType: 'trait', rollTarget: 'agility', rollModifier: '+2' },
      character()
    );
    expect(trait).toMatchObject({
      formula: '2d12+2',
      native: {
        kind: 'daggerheart-dice-roll',
        config: { roll: { type: 'trait', trait: 'agility' }, extraFormula: '2' },
      },
    });
    expect(
      rolls.questions.plan({ rollType: 'spellcast' }, character()).native?.config
    ).toMatchObject({
      roll: { type: 'spellcast' },
    });
    expect(
      rolls.questions.plan({ rollType: 'attack', rollTarget: 'finesse' }, character()).native
    ).toBeDefined();
    expect(
      rolls.questions.plan({ rollType: 'custom', rollTarget: '1d6', rollModifier: '-1' }, null)
    ).toEqual({
      formula: '1d6-1',
      label: 'Custom roll',
    });
    expect(() =>
      rolls.questions.plan({ rollType: 'trait', rollTarget: 'acrobatics' }, character())
    ).toThrow(/one of agility/);
    expect(
      registry
        .answer(system, 'actorData')
        .questions.normalize?.({ custom: 42 }, { actorType: 'character', mode: 'update' })
    ).toEqual({ custom: 42 });
  });
});
