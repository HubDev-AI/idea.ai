import { scorePain } from '@idea/pipeline/src/scoring/pain';
import { scoreTiming } from '@idea/pipeline/src/scoring/timing';
import { scoreBuildability } from '@idea/pipeline/src/scoring/buildability';
import { blendedScore } from '@idea/pipeline/src/scoring/blend';

export const scoreSignal = ({
  text,
  judgeScores
}: {
  text: string;
  judgeScores: [number, number, number];
}) => {
  const pain = scorePain(text);
  const timing = scoreTiming(text);
  const buildability = scoreBuildability(judgeScores);

  return {
    pain,
    timing,
    buildability,
    blended: blendedScore({ pain, timing, buildability })
  };
};
