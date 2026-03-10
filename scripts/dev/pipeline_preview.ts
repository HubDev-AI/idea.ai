import { createLiveReadModel } from '../../apps/api/src/runtime/live_read_model';
import { findIdeaCandidates } from '../../apps/api/src/runtime/signal_quality';

const preview = async () => {
  const readModel = createLiveReadModel(0);

  try {
    const snapshot = await readModel.startRefresh();
    const openConnectors = snapshot.connectors.filter((connector) => !connector.name.endsWith('_byo'));
    const byoConnectors = snapshot.connectors.filter((connector) => connector.name.endsWith('_byo'));

    console.log('Connector status:');
    console.log(
      JSON.stringify(
        {
          open: Object.fromEntries(openConnectors.map((connector) => [connector.name, connector.status])),
          byo: Object.fromEntries(byoConnectors.map((connector) => [connector.name, connector.status]))
        },
        null,
        2
      )
    );

    if (snapshot.signals.length === 0) {
      console.log('\nNo ranked signals available yet.');
      return;
    }

    const top = snapshot.signals.slice(0, 10).map((item, index) => ({
      rank: index + 1,
      score: item.score,
      source: item.top_source,
      next_action: item.next_action,
      idea: item.idea
    }));

    console.log('\nTop 10 ranked signals:\n');
    console.table(top);

    const ideas = findIdeaCandidates(snapshot.signals, 5);
    if (ideas.length === 0) {
      console.log('\nNo high-confidence idea candidate in this run.');
      return;
    }

    console.log(`\nIDEA CANDIDATES FOUND (${ideas.length}):\n`);
    console.table(
      ideas.map((item, index) => ({
        rank: index + 1,
        score: item.score,
        source: item.top_source,
        next_action: item.next_action,
        idea: item.idea
      }))
    );
  } finally {
    await readModel.close();
  }
};

preview().catch((error) => {
  console.error(error);
  process.exit(1);
});
