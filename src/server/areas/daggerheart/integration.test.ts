import { afterEach, describe, expect, it } from 'vitest';
import { daggerheartAdapter } from '../../../common/areas/daggerheart/adapter.js';
import { moduleSystemAdapters } from '../../../module/game-systems.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { creatureIndex } from '../../../module/areas/compendiums/creature-index.js';
import { memoryIndexStore, withCompendiums } from '../../../module/areas/compendiums/testing.js';
import { serverSystemAdapters, systemDetector } from '../../game-systems.js';

let harness: AreaHarness | undefined;
let nativeRollCalls: Array<Record<string, unknown>> = [];
let resourceUpdatesApplied = 0;
afterEach(() => {
  harness?.close();
  harness = undefined;
  nativeRollCalls = [];
  resourceUpdatesApplied = 0;
  systemDetector.invalidate();
  creatureIndex.useStore(null);
});

function open() {
  systemDetector.invalidate();
  const foundry = new FakeFoundry({ system: { id: 'daggerheart', version: '2.9.4' } });
  withCompendiums(foundry, [
    {
      id: 'daggerheart.adversaries',
      label: 'Test adversaries',
      type: 'Actor',
      entries: [
        {
          _id: 'standard2',
          name: 'Test Standard',
          type: 'adversary',
          system: {
            tier: 2,
            type: 'standard',
            difficulty: 14,
            resources: { hitPoints: { max: 5 }, stress: { max: 3 } },
          },
        },
        {
          _id: 'solo2',
          name: 'Test Solo',
          type: 'adversary',
          system: { tier: 2, type: 'solo', difficulty: 16 },
        },
        {
          _id: 'standard1',
          name: 'Test Lower Tier',
          type: 'adversary',
          system: { tier: 1, type: 'standard', difficulty: 10 },
        },
        {
          _id: 'environment',
          name: 'Test Environment',
          type: 'environment',
          system: { tier: 2, type: 'standard', difficulty: 14 },
        },
      ],
    },
  ]);
  creatureIndex.useStore(memoryIndexStore());
  harness = createAreaHarness({ foundry });
  const actor = foundry.seed('Actor', {
    _id: 'scout',
    name: 'Test Scout',
    type: 'character',
    system: { evasion: 0, resources: { hitPoints: { value: 2, max: null } } },
    items: [
      {
        _id: 'spell',
        name: 'Test Spell',
        type: 'domainCard',
        system: { type: 'spell', domain: 'arcana', inVault: false, recallCost: 0 },
      },
      {
        _id: 'ability',
        name: 'Test Ability',
        type: 'domainCard',
        system: { type: 'ability', domain: 'blade', inVault: true },
      },
    ],
  });
  const stored = actor.toObject();
  Object.defineProperty(actor, 'toObject', { value: () => structuredClone(stored) });
  Object.defineProperty(actor, 'system', {
    configurable: true,
    value: {
      evasion: 12,
      resources: { hitPoints: { value: 2, max: 6 }, hope: { value: 3, max: 6 } },
    },
  });
  Object.defineProperty(actor, 'diceRoll', {
    configurable: true,
    value: async (config: Record<string, unknown>) => {
      nativeRollCalls.push(config);
      return {
        roll: {
          formula: '2d12+2',
          total: 15,
          dice: [],
          hope: { dice: 'd12', value: 10 },
          fear: { dice: 'd12', value: 5 },
          result: { duality: 1, total: 15, label: 'Hope' },
          isCritical: false,
        },
        message: { id: 'native-chat' },
        resourceUpdates: {
          updateResources: async () => {
            resourceUpdatesApplied += 1;
          },
        },
      };
    },
  });
  return harness;
}
const json = (result: { content: Array<{ type: string; text?: string }>; isError?: boolean }) => {
  expect(result.isError, result.content[0]?.text).not.toBe(true);
  return JSON.parse(result.content[0]?.text ?? 'null');
};

describe('Daggerheart through the MCP server and module', () => {
  it('registers the same adapter on both sides and returns prepared values through get-character', async () => {
    const h = open();
    expect(moduleSystemAdapters.find('daggerheart')).toBe(daggerheartAdapter);
    expect(serverSystemAdapters.find('daggerheart')).toBe(daggerheartAdapter);
    const result = json(await h.call('get-character', { identifier: 'scout' }));
    expect(result).toMatchObject({
      gameSystem: { adapter: 'daggerheart' },
      basicInfo: {
        evasion: 12,
        hitPoints: { marked: 2, remaining: 4 },
        hope: { value: 3, meaning: 'available' },
      },
      spellcasting: [{ kind: 'domain-cards', spells: [{ id: 'spell', prepared: true }] }],
      notes: [],
    });
    expect(result.system).toBeUndefined();
  });

  it('exposes spell and vault categories through search-character-items', async () => {
    const h = open();
    const spells = json(
      await h.call('search-character-items', { characterIdentifier: 'scout', category: 'spells' })
    );
    const vault = json(
      await h.call('search-character-items', { characterIdentifier: 'scout', category: 'vault' })
    );
    expect(JSON.stringify(spells)).toContain('Test Spell');
    expect(JSON.stringify(spells)).not.toContain('Test Ability');
    expect(JSON.stringify(vault)).toContain('Test Ability');
    expect(JSON.stringify(vault)).not.toContain('Test Spell');
  });

  it('describes Daggerheart actor paths and resource semantics through manage-actors', async () => {
    const h = open();
    const answer = await h.call('manage-actors', { action: 'describe' });
    expect(answer.isError).not.toBe(true);
    expect(JSON.stringify(answer)).toContain('MARKED');
    expect(JSON.stringify(answer)).toContain('levelData.level.current');
  });

  it('filters the actual creature index by tier, role, difficulty and stress', async () => {
    const h = open();
    const result = json(
      await h.call('list-creatures-by-criteria', {
        tier: 2,
        adversaryType: 'standard',
        difficulty: { min: 13, max: 15 },
        stress: 3,
      })
    );
    expect(result).toMatchObject({
      totalFound: 1,
      source: 'creature-index',
      creatures: [
        {
          id: 'standard2',
          tier: 2,
          adversaryType: 'standard',
          difficulty: 14,
          hitPoints: 5,
          stress: 3,
        },
      ],
    });
  });

  it('passes Daggerheart filters through search-compendium as well', async () => {
    const h = open();
    const result = json(
      await h.call('search-compendium', {
        query: 'Test',
        packType: 'Actor',
        filters: { tier: 2, adversaryType: 'solo' },
      })
    );
    expect(JSON.stringify(result)).toContain('Test Solo');
    expect(JSON.stringify(result)).not.toContain('Test Standard');
    expect(JSON.stringify(result)).not.toContain('Test Environment');
  });

  it('uses the native Duality Roll and applies its resource update queue', async () => {
    const h = open();
    const result = json(
      await h.call('roll-actor-check', {
        actorId: 'scout',
        rollType: 'trait',
        rollTarget: 'agility',
        rollModifier: '+2',
        toChat: true,
        rollMode: 'gmroll',
      })
    );
    expect(result).toMatchObject({
      rollType: 'trait',
      formula: '2d12+2',
      total: 15,
      duality: 1,
      hope: { value: 10 },
      fear: { value: 5 },
      resourcesApplied: true,
      chat: { messageId: 'native-chat', rollMode: 'gmroll' },
    });
    expect(nativeRollCalls).toHaveLength(1);
    expect(nativeRollCalls[0]).toMatchObject({
      roll: { type: 'trait', trait: 'agility' },
      extraFormula: '2',
      selectedMessageMode: 'gmroll',
      skips: { createMessage: false },
    });
    expect(resourceUpdatesApplied).toBe(1);
  });
});
