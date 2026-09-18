import { daggerheartAdapter } from '../../../common/areas/daggerheart/adapter.js';
import type { ModuleArea } from '../../areas.js';

export const daggerheartArea: ModuleArea = {
  id: 'daggerheart',
  adapters: [daggerheartAdapter],
  queries: [],
  settings: [],
};
