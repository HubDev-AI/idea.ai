import type { FastifyInstance } from 'fastify';
import { loadProfiles } from '../profiles/index.js';

export const registerProfilesRoute = (app: FastifyInstance): void => {
  app.get('/v1/profiles', async () => {
    const profiles = loadProfiles();
    return profiles.map(p => ({
      id: p.id,
      name: p.name,
      display: p.display,
      dimensions: p.scoring.dimensions.map(d => ({ name: d.name, weight: d.weight })),
    }));
  });
};
