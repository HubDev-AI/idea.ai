import type { SignalRecord } from './api';

const lowValueTitlePattern =
  /^(account executive|sales development representative|business development representative|software engineer|senior software engineer|staff software engineer|product manager|customer success manager|solutions engineer|technical support engineer|marketing manager)\b/i;
const recruitingMarkers = [
  'who we are',
  'about us',
  'job description',
  'responsibilities',
  'qualifications',
  'what you will do',
  'what you ll do',
  'apply now',
  'apply for this role',
  'equal opportunity employer'
];

const isLowValueTitle = (text: string): boolean => lowValueTitlePattern.test(text.trim());
const isRecruitingLikeText = (text: string): boolean =>
  recruitingMarkers.some((marker) => text.toLowerCase().includes(marker));

export const isIdeaCandidateSignal = (
  signal: Pick<SignalRecord, 'idea' | 'score' | 'top_source' | 'next_action' | 'snippet'>
): boolean => {
  const normalized = `${signal.idea} ${signal.snippet}`.toLowerCase();
  if (isLowValueTitle(signal.idea) || isRecruitingLikeText(normalized)) {
    return false;
  }

  if (signal.score >= 50) {
    return true;
  }

  return signal.score >= 46 && signal.next_action !== 'validate_channel';
};
