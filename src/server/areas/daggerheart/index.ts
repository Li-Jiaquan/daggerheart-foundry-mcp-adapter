import { daggerheartAdapter } from '../../../common/areas/daggerheart/adapter.js';
import type { ServerArea } from '../../tools/areas.js';

export const daggerheartArea: ServerArea = {
  id: 'daggerheart',
  adapters: [daggerheartAdapter],
  tools: [],
  resources: [],
  prompts: [],
};
