import { fetchGithubIssueEvents } from '@idea/connectors/src/github_issues';
import { fetchGreenhouseJobEvents } from '@idea/connectors/src/greenhouse';
import { fetchHnEvents } from '@idea/connectors/src/hn';
import { fetchLeverJobEvents } from '@idea/connectors/src/lever';
import { OPEN_CONNECTOR_CADENCE, type Cadence, type RawEventInput } from '@idea/connectors/src/common/http';

export const runOpenConnectorIngestion = async (cadence: Cadence): Promise<RawEventInput[]> => {
  const events: RawEventInput[] = [];

  if (OPEN_CONNECTOR_CADENCE.hn === cadence) {
    events.push(...(await fetchHnEvents()));
  }

  if (OPEN_CONNECTOR_CADENCE.github_issues === cadence) {
    events.push(...(await fetchGithubIssueEvents()));
  }

  if (OPEN_CONNECTOR_CADENCE.greenhouse === cadence) {
    events.push(...(await fetchGreenhouseJobEvents()));
  }

  if (OPEN_CONNECTOR_CADENCE.lever === cadence) {
    events.push(...(await fetchLeverJobEvents()));
  }

  return events;
};
