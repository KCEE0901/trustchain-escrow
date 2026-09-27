/**
 * ReputationBadge Component
 *
 * Displays a numerical reputation score with a color-coded ring and hover tooltip.
 *
 * @param {object} props
 * @param {number} props.score  — 0–1000+
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {object} [props.scoreBreakdown] — Optional breakdown of score components
 * @param {number} [props.scoreBreakdown.completed] — Number of completed escrows
 * @param {number} [props.scoreBreakdown.disputeWins] — Number of dispute wins
 * @param {number} [props.scoreBreakdown.disputeLosses] — Number of dispute losses
 *
 * TODO (contributor — easy, Issue #28):
 * - Color ring based on score tier (matches BADGE_THRESHOLDS in reputationService)
 * - Add animated ring fill (CSS conic-gradient) proportional to score
 */

'use client';

import Tooltip from './Tooltip';

export default function ReputationBadge({ score, size = 'md', scoreBreakdown }) {
  const color =
    score >= 500
      ? 'text-amber-400 ring-amber-400/30'
      : score >= 250
        ? 'text-purple-400 ring-purple-400/30'
        : score >= 100
          ? 'text-indigo-400 ring-indigo-400/30'
          : 'text-gray-400 ring-gray-600/30';

  const sizeClass =
    size === 'sm'
      ? 'w-10 h-10 text-sm'
      : size === 'lg'
        ? 'w-16 h-16 text-xl'
        : 'w-12 h-12 text-base';

  const getTier = (score) => {
    if (score >= 500) return 'Excellent';
    if (score >= 250) return 'Good';
    if (score >= 100) return 'Fair';
    return 'New';
  };

  const getTooltipContent = () => {
    if (!scoreBreakdown) {
      return `${getTier(score)} • Score: ${score}`;
    }

    const { completed = 0, disputeWins = 0, disputeLosses = 0 } = scoreBreakdown;
    return `Score: ${score} | Completed: ${completed} | Dispute Wins: ${disputeWins} | Dispute Losses: ${disputeLosses}`;
  };

  return (
    <Tooltip content={getTooltipContent()} position="top">
      <div
        className={`${sizeClass} ${color} rounded-full ring-2 flex items-center justify-center font-bold cursor-help`}
        aria-label={`Reputation: ${getTier(score)} (${score} points)`}
      >
        {score}
      </div>
    </Tooltip>
  );
}
